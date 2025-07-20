

"use server"
import 'dotenv/config';

import fs from "fs/promises"
import path from "path"
import {
  generateTournamentGroups,
  type GenerateTournamentGroupsOutput
} from "@/ai/flows/generate-tournament-groups"
import type { TournamentsState, CategoryData, GlobalSettings, Team, PlayoffBracket, PlayoffBracketSet, GenerateTournamentGroupsInput, PlayoffMatch, MatchWithScore, Court, TournamentFormValues, GroupWithScores, TimeSlot, UpdateMatchInput as UpdateMatchInputType } from "@/lib/types"
import { z } from 'zod';
import { format, addMinutes, parse, isBefore, startOfDay, isAfter, setHours, setMinutes, differenceInMilliseconds, isEqual, differenceInMinutes } from 'date-fns';
import { calculateTotalMatches, initializeDoubleEliminationBracket, initializePlayoffs, initializeStandings } from '@/lib/regeneration';
import Papa from 'papaparse';
import { scheduleMatches, type MatchRow, type SchedulingLog } from '@/lib/scheduler';


const dbPath = path.resolve(process.cwd(), "db.json")

// Zod schema for the output of the algorithmic group generation.
// This is necessary because we can no longer import it from the flow.
const GenerateTournamentGroupsOutputSchema = z.object({
  groups: z.array(
    z.object({
      name: z.string(),
      teams: z.array(z.object({ player1: z.string(), player2: z.string() })),
      matches: z.array(z.object({ 
        team1: z.object({ player1: z.string(), player2: z.string() }),
        team2: z.object({ player1: z.string(), player2: z.string() })
      })),
    })
  ),
  playoffMatches: z.array(z.any()).optional(), // Keep playoffMatches flexible or define schema if needed
});


async function readDb(): Promise<TournamentsState> {
  try {
    const fileContent = await fs.readFile(dbPath, "utf-8")
    const data = JSON.parse(fileContent)
    // Ensure global settings exist
    if (!data._globalSettings) {
      data._globalSettings = {
        startTime: "08:00",
        endTime: "21:00",
        estimatedMatchDuration: 20,
        courts: [{ name: "Quadra 1", slots: [{startTime: "09:00", endTime: "18:00"}], priority: 1 }]
      };
    }
    return data;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const defaultData = {
        _globalSettings: {
            startTime: "08:00",
            endTime: "21:00",
            estimatedMatchDuration: 20,
            courts: [{ name: "Quadra 1", slots: [{startTime: "09:00", endTime: "18:00"}], priority: 1 }]
        }
      };
      await writeDb(defaultData);
      return defaultData;
    }
    console.error("Error reading from DB:", error)
    throw new Error("Could not read from database.")
  }
}

async function writeDb(data: TournamentsState) {
  try {
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2), "utf-8")
  } catch (error) {
    console.error("Error writing to DB:", error)
    throw new Error("Could not write to database.")
  }
}

export async function getTournaments(): Promise<TournamentsState> {
    return await readDb();
}

export async function getTournamentByCategory(category: string): Promise<CategoryData | null> {
    const db = await readDb();
    return db[category] || null;
}

export async function saveGlobalSettings(settings: GlobalSettings): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();
        db._globalSettings = settings;
        await writeDb(db);
        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message || "Ocorreu um erro desconhecido ao salvar as configurações globais." };
    }
}


export async function saveTournament(categoryName: string, data: CategoryData): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();
        db[categoryName] = data;
        await writeDb(db);
        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message || "Ocorreu um erro desconhecido ao salvar." };
    }
}

const baseDate = startOfDay(new Date());

const parseTime = (timeStr: string): Date => {
    if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) {
        console.warn(`Invalid time string provided: ${timeStr}. Defaulting to epoch.`);
        return new Date(0);
    }
    const [h, m] = timeStr.split(':').map(Number);
    let date = new Date(baseDate);
    date = setHours(date, h);
    date = setMinutes(date, m);
    date.setSeconds(0, 0);
    return date;
};


const teamToKey = (team?: Team): string => {
    if (!team || !team.player1 || !team.player2) return '';
    const players = [team.player1.trim(), team.player2.trim()].sort();
    return `${players[0]} e ${players[1]}`;
};

function extractDependencies(placeholder: string | undefined): { matchDeps: string[], groupDeps: string[] } {
    const deps = { matchDeps: [] as string[], groupDeps: [] as string[] };
    if (!placeholder) return deps;
    
    const matchDepMatch = placeholder.match(/(?:Vencedor|Perdedor)\s(.+)/);
    if (matchDepMatch && matchDepMatch[1]) {
        deps.matchDeps.push(matchDepMatch[1].trim());
        return deps;
    }
    
    const groupDepMatch = placeholder.match(/\d+º\sdo\s(.+)/);
    if (groupDepMatch && groupDepMatch[1]) {
        deps.groupDeps.push(groupDepMatch[1].trim());
    }
    
    return deps;
}


function teamIsEqual(teamA?: Team, teamB?: Team) {
    if (!teamA || !teamB) return false;
    if(!teamA.player1 || !teamA.player2 || !teamB.player1 || !teamB.player2) return false;
    const teamAPlayers = [teamA.player1, teamA.player2].sort();
    const teamBPlayers = [teamB.player1, teamB.player2].sort();
    return teamAPlayers[0] === teamBPlayers[0] && teamAPlayers[1] === teamBPlayers[1];
}


export async function renameTournament(oldCategoryName: string, newCategoryName: string): Promise<{ success: boolean; error?: string }> {
    try {
        if (!oldCategoryName || !newCategoryName) {
            return { success: false, error: "Os nomes da categoria não podem ser vazios." };
        }
        if (oldCategoryName === newCategoryName) {
            return { success: true }; // No change needed
        }

        const db = await readDb();

        if (!db[oldCategoryName]) {
            return { success: false, error: `A categoria "${oldCategoryName}" não foi encontrada.` };
        }
        if (db[newCategoryName]) {
            return { success: false, error: `A categoria "${newCategoryName}" já existe.` };
        }

        const categoryData = db[oldCategoryName];
        categoryData.formValues.category = newCategoryName; // Update internal name

        db[newCategoryName] = categoryData;
        delete db[oldCategoryName];
        
        await writeDb(db);
        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message || "Ocorreu um erro desconhecido ao renomear." };
    }
}


export async function deleteTournament(categoryName: string): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();
        if (db[categoryName]) {
            delete db[categoryName];
            await writeDb(db);
            return { success: true };
        }
        return { success: false, error: "Categoria não encontrada." };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message || "Ocorreu um erro desconhecido ao excluir." };
    }
}

// Algorithmic group and match generation
function generateGroupsAlgorithmically(input: GenerateTournamentGroupsInput): GenerateTournamentGroupsOutput {
    const { teams, numberOfGroups, groupFormationStrategy } = input;
    
    if (!numberOfGroups) {
      throw new Error("Número de grupos não fornecido.");
    }

    let teamsToDistribute = [...teams];
    if (groupFormationStrategy === 'random') {
        // Fisher-Yates shuffle
        for (let i = teamsToDistribute.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [teamsToDistribute[i], teamsToDistribute[j]] = [teamsToDistribute[j], teamsToDistribute[i]];
        }
    }
    
    const groupsData: { name: string; teams: Team[]; matches: { team1: Team; team2: Team }[] }[] = Array.from({ length: numberOfGroups }, (_, i) => ({
        name: `Group ${String.fromCharCode(65 + i)}`,
        teams: [],
        matches: []
    }));

    // Distribute teams into groups (serpentine for 'order', sequential for 'random' because it's already shuffled)
    teamsToDistribute.forEach((team, index) => {
        let groupIndex: number;
        if (groupFormationStrategy === 'order') {
            const round = Math.floor(index / numberOfGroups);
            const isEvenRound = round % 2 === 0;
            const pick = index % numberOfGroups;
            groupIndex = isEvenRound ? pick : numberOfGroups - 1 - pick;
        } else {
            groupIndex = index % numberOfGroups;
        }
        groupsData[groupIndex].teams.push(team);
    });

    // Generate round-robin matches for each group
    groupsData.forEach(group => {
        for (let i = 0; i < group.teams.length; i++) {
            for (let j = i + 1; j < group.teams.length; j++) {
                group.matches.push({
                    team1: group.teams[i],
                    team2: group.teams[j]
                });
            }
        }
    });

    return GenerateTournamentGroupsOutputSchema.parse({ groups: groupsData, playoffMatches: [] });
}


export async function generateGroupsAction(
  input: GenerateTournamentGroupsInput
): Promise<{
  success: boolean
  data?: GenerateTournamentGroupsOutput
  error?: string
}> {
  try {
    let output: GenerateTournamentGroupsOutput;

    if (input.tournamentType === 'groups') {
        output = generateGroupsAlgorithmically(input);
    } else {
        // Use AI for single and double elimination
        output = await generateTournamentGroups(input);
    }
    
    if (input.tournamentType === 'groups') {
      if (!output.groups || output.groups.length === 0) {
        return { success: false, error: "Não foi possível gerar os grupos. Verifique os parâmetros." };
      }
    } else if (input.tournamentType === 'singleElimination' || input.tournamentType === 'doubleElimination') {
      if (!output.playoffMatches || output.playoffMatches.length === 0) {
        return { success: false, error: "A IA não conseguiu gerar o chaveamento. Tente novamente." };
      }
    }

    return { success: true, data: output };
  } catch (e: any) {
    console.error(e);
    return { success: false, error: e.message || "Ocorreu um erro desconhecido." };
  }
}

export async function verifyPassword(password: string): Promise<{ success: boolean }> {
  const correctPassword = process.env.ADMIN_PASSWORD || "1234";
  if (!correctPassword) {
    console.error("ADMIN_PASSWORD is not set in .env file");
    return { success: false };
  }
  return { success: password === correctPassword };
}


export async function updateTeamInTournament(
  categoryName: string,
  originalTeam: Team,
  updatedTeam: Team
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await readDb();
    const categoryData = db[categoryName];

    if (!categoryData) {
      return { success: false, error: "Categoria não encontrada." };
    }

    const originalTeamKey = teamToKey(originalTeam);
    const updatedTeamKey = teamToKey(updatedTeam);
    
    // Update teams in formValues.teams string
    if (categoryData.formValues.teams) {
        const teamsList = categoryData.formValues.teams.split('\n');
        const teamIndex = teamsList.findIndex(t => teamToKey({ player1: t.split(' e ')[0], player2: t.split(' e ')[1] }) === originalTeamKey);
        if (teamIndex !== -1) {
            teamsList[teamIndex] = updatedTeamKey;
            categoryData.formValues.teams = teamsList.join('\n');
        }
    }

    // Update teams in tournamentData (groups)
    if (categoryData.tournamentData?.groups) {
      const groups = Array.isArray(categoryData.tournamentData.groups) ? categoryData.tournamentData.groups : Object.values(categoryData.tournamentData.groups);
      groups.forEach(group => {
        // Update group.teams array
        group.teams = group.teams.map(t => teamIsEqual(t, originalTeam) ? { ...updatedTeam } : t);

        // Update group.matches
        group.matches.forEach(match => {
          if (teamIsEqual(match.team1, originalTeam)) match.team1 = { ...updatedTeam };
          if (teamIsEqual(match.team2, originalTeam)) match.team2 = { ...updatedTeam };
        });

        // Update group.standings
        group.standings.forEach(standing => {
          if (teamIsEqual(standing.team, originalTeam)) standing.team = { ...updatedTeam };
        });
      });
      categoryData.tournamentData.groups = groups;
    }

    // Update teams in playoffs
    if (categoryData.playoffs) {
        const updatePlayoffBracket = (bracket: PlayoffBracket | undefined) => {
            if (!bracket) return;
            Object.values(bracket).forEach(round => {
                round.forEach(match => {
                    if (match.team1 && teamIsEqual(match.team1, originalTeam)) match.team1 = { ...updatedTeam };
                    if (match.team2 && teamIsEqual(match.team2, originalTeam)) match.team2 = { ...updatedTeam };
                });
            });
        };
        
        const bracketSet = categoryData.playoffs as PlayoffBracketSet;
        if(bracketSet.upper || bracketSet.lower || bracketSet.playoffs) {
            updatePlayoffBracket(bracketSet.upper);
            updatePlayoffBracket(bracketSet.lower);
            updatePlayoffBracket(bracketSet.playoffs);
        } else {
             updatePlayoffBracket(bracketSet as PlayoffBracket)
        }
    }

    await writeDb(db);
    return { success: true };

  } catch (e: any) {
    console.error("Error updating team:", e);
    return { success: false, error: e.message || "Ocorreu um erro desconhecido ao atualizar a dupla." };
  }
}

async function createOrUpdateCategory(values: TournamentFormValues): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();
        const categoryName = values.category;
        const oldCategoryData = db[categoryName] || {};

        let newCategoryData: CategoryData = {
            ...oldCategoryData,
            tournamentData: null,
            playoffs: null,
            formValues: values,
        };

        if (values.tournamentType === 'doubleElimination') {
            const finalPlayoffs = await initializeDoubleEliminationBracket(values, categoryName);
            newCategoryData.playoffs = finalPlayoffs;
        } else {
            const teamsArray: Team[] = values.teams
                .split("\n")
                .map((t) => t.trim())
                .filter(Boolean)
                .map((teamString) => {
                    const players = teamString.split(/\s+e\s+/i).map((p) => p.trim())
                    return { player1: players[0] || "", player2: players[1] || "" }
                });

            const result = await generateGroupsAction({
                numberOfTeams: values.numberOfTeams,
                numberOfGroups: values.numberOfGroups,
                groupFormationStrategy: values.groupFormationStrategy,
                teams: teamsArray,
                category: values.category,
                tournamentType: values.tournamentType,
            });

            if (!result.success || !result.data) {
                return { success: false, error: result.error || "Ocorreu um erro inesperado na geração." };
            }

            if (values.tournamentType === 'groups') {
                const initializedGroups = await initializeStandings(result.data.groups, categoryName);
                const initializedPlayoffs = await initializePlayoffs(values, categoryName, result.data);

                newCategoryData.tournamentData = { groups: initializedGroups };
                newCategoryData.playoffs = initializedPlayoffs;

            } else if (values.tournamentType === 'singleElimination') {
                newCategoryData.playoffs = await initializePlayoffs(values, categoryName, result.data);
            }
        }
        
        newCategoryData.totalMatches = await calculateTotalMatches(newCategoryData);
        
        db[categoryName] = newCategoryData;
        await writeDb(db);
        
        return { success: true };

    } catch (e: any) {
        console.error("Error creating/updating category:", e);
        return { success: false, error: e.message || "Ocorreu um erro desconhecido ao criar/atualizar a categoria." };
    }
}


export async function regenerateCategory(categoryName: string, newFormValues?: TournamentFormValues): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();
        const existingCategory = db[categoryName] as CategoryData;

        if (!existingCategory && !newFormValues) {
            return { success: false, error: "Categoria não encontrada para regenerar." };
        }
        
        const valuesToUse = newFormValues || existingCategory.formValues;

        if (!valuesToUse) {
            return { success: false, error: "Não foram encontrados valores de formulário para regenerar a categoria." };
        }

        return await createOrUpdateCategory(valuesToUse);
    } catch (e: any) {
        console.error("Error regenerating category:", e);
        return { success: false, error: e.message || "Ocorreu um erro desconhecido ao regenerar a categoria." };
    }
}

type UpdateMatchInput = {
    matchId: string;
    categoryName: string;
    time: string;
    court: string;
    phaseStartTime?: string;
};

export async function updateMatch(input: UpdateMatchInput): Promise<{ success: boolean; error?: string }> {
    try {
        const { matchId, categoryName, time, court, phaseStartTime } = input;
        const db = await readDb();

        const categoryData = db[categoryName] as CategoryData;
        if (!categoryData) {
            return { success: false, error: "Categoria não encontrada." };
        }

        let matchFound = false;

        // Search in group matches
        if (categoryData.tournamentData?.groups) {
            for (const group of categoryData.tournamentData.groups) {
                const match = group.matches.find(m => m.id === matchId);
                if (match) {
                    match.time = time;
                    match.court = court;
                    matchFound = true;
                    break;
                }
            }
        }
        
        // Search in playoffs
        if (!matchFound && categoryData.playoffs) {
             const findAndUpdateInBracket = (bracket: PlayoffBracket | undefined) => {
                if (!bracket) return;
                for (const round of Object.values(bracket)) {
                    for(const match of round) {
                        // If phaseStartTime is provided, update all matches in the same round
                        if (phaseStartTime !== undefined && match.name.startsWith(round[0].name.split(' ')[0])) {
                           match.phaseStartTime = phaseStartTime;
                        }
                        if (match.id === matchId) {
                            match.time = time;
                            match.court = court;
                            matchFound = true;
                        }
                    }
                }
            };
            
            const bracketSet = categoryData.playoffs as PlayoffBracketSet;
            if(bracketSet.upper || bracketSet.lower || bracketSet.playoffs) {
                findAndUpdateInBracket(bracketSet.upper);
                findAndUpdateInBracket(bracketSet.lower);
                findAndUpdateInBracket(bracketSet.playoffs);
            } else {
                findAndUpdateInBracket(bracketSet as PlayoffBracket)
            }
        }


        if (!matchFound && phaseStartTime === undefined) {
            return { success: false, error: "Jogo não encontrado." };
        }

        await writeDb(db);
        return { success: true };

    } catch (e: any) {
        console.error("Erro ao atualizar o jogo:", e);
        return { success: false, error: e.message || "Erro desconhecido ao atualizar o jogo." };
    }
}

export async function updateMultipleMatches(matches: UpdateMatchInputType[]): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();

        for (const { matchId, categoryName, time, court } of matches) {
            const categoryData = db[categoryName] as CategoryData;
            if (!categoryData) continue;

            let matchFound = false;
            const findAndUpdate = (currentMatch: MatchWithScore | PlayoffMatch) => {
                if (currentMatch.id === matchId) {
                    currentMatch.time = time;
                    currentMatch.court = court;
                    return true;
                }
                return false;
            };

            const findAndUpdateInBracket = (bracket?: PlayoffBracket) => {
                if (!bracket) return;
                for (const round of Object.values(bracket)) {
                    for (const match of round) {
                        if (findAndUpdate(match)) {
                            matchFound = true;
                            return;
                        }
                    }
                }
            };
            
            if (categoryData.tournamentData?.groups) {
                for (const group of categoryData.tournamentData.groups) {
                    for (const match of group.matches) {
                        if (findAndUpdate(match)) {
                            matchFound = true;
                            break;
                        }
                    }
                    if (matchFound) break;
                }
            }
            
            if (!matchFound && categoryData.playoffs) {
                const bracketSet = categoryData.playoffs as PlayoffBracketSet;
                if(bracketSet.upper || bracketSet.lower || bracketSet.playoffs) {
                    findAndUpdateInBracket(bracketSet.upper);
                    if (!matchFound) findAndUpdateInBracket(bracketSet.lower);
                    if (!matchFound) findAndUpdateInBracket(bracketSet.playoffs);
                } else {
                    findAndUpdateInBracket(bracketSet as PlayoffBracket)
                }
            }
        }

        await writeDb(db);
        return { success: true };
    } catch (e: any) {
        console.error("Erro ao atualizar os jogos:", e);
        return { success: false, error: e.message || "Erro desconhecido ao atualizar os jogos." };
    }
}


type CsvRow = {
    matchId: string;
    time: string;
    court: string;
};

export async function importScheduleFromCSV(csvData: string): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();

        const allDbMatchIds = new Set<string>();
        Object.entries(db).forEach(([categoryName, categoryData]) => {
            if (categoryName === '_globalSettings') return;
            const category = categoryData as CategoryData;
            
            const addMatchIds = (matches: (MatchWithScore | PlayoffMatch)[]) => {
                if (!Array.isArray(matches)) return;
                matches.forEach(m => m.id && allDbMatchIds.add(m.id));
            };

            category.tournamentData?.groups.forEach(g => addMatchIds(g.matches));
            
            const processPlayoffBracket = (bracket?: PlayoffBracket) => {
                if (!bracket) return;
                Object.values(bracket).flat().forEach(m => m.id && allDbMatchIds.add(m.id));
            };

            if (category.playoffs) {
                const playoffs = category.playoffs as PlayoffBracketSet;
                 if (playoffs.upper || playoffs.lower || playoffs.playoffs) {
                    processPlayoffBracket(playoffs.upper);
                    processPlayoffBracket(playoffs.lower);
                    processPlayoffBracket(playoffs.playoffs);
                } else {
                    processPlayoffBracket(playoffs as PlayoffBracket);
                }
            }
        });

        const parsed = Papa.parse<CsvRow>(csvData.trim(), { header: true, skipEmptyLines: true });
        if (parsed.errors.length > 0) {
            console.error("CSV Parsing errors:", parsed.errors);
            return { success: false, error: `Erro ao ler o CSV: ${parsed.errors[0].message}` };
        }
        
        const csvRows = parsed.data;
        const csvMatchIds = new Set(csvRows.map(row => row.matchId));

        const missingIds: string[] = [];
        for (const dbId of allDbMatchIds) {
            if (!csvMatchIds.has(dbId)) {
                missingIds.push(dbId);
            }
        }

        if (missingIds.length > 0) {
            return { 
                success: false, 
                error: `O CSV está incompleto. ${missingIds.length} jogos não foram encontrados no arquivo. IDs faltantes: ${missingIds.slice(0, 5).join(', ')}...`
            };
        }
        
        // Create a map for quick lookups
        const scheduleMap = new Map<string, { time: string, court: string }>();
        csvRows.forEach(row => {
            if (row.matchId) {
                scheduleMap.set(row.matchId, { time: row.time || '', court: row.court || '' });
            }
        });

        // Iterate through the db object and update it directly
        for (const categoryName in db) {
            if (categoryName === '_globalSettings') continue;
            const category = db[categoryName] as CategoryData;

            // Update group matches
            category.tournamentData?.groups.forEach(group => {
                group.matches.forEach(match => {
                    if (match.id && scheduleMap.has(match.id)) {
                        const newSchedule = scheduleMap.get(match.id)!;
                        match.time = newSchedule.time;
                        match.court = newSchedule.court;
                    }
                });
            });

            // Update playoff matches
            const updateBracket = (bracket?: PlayoffBracket) => {
                if (!bracket) return;
                Object.values(bracket).forEach(round => {
                    round.forEach(match => {
                        if (match.id && scheduleMap.has(match.id)) {
                            const newSchedule = scheduleMap.get(match.id)!;
                            match.time = newSchedule.time;
                            match.court = newSchedule.court;
                        }
                    });
                });
            };

            if (category.playoffs) {
                const playoffs = category.playoffs as PlayoffBracketSet;
                if (playoffs.upper || playoffs.lower || playoffs.playoffs) {
                    updateBracket(playoffs.upper);
                    updateBracket(playoffs.lower);
                    updateBracket(playoffs.playoffs);
                } else {
                    updateBracket(playoffs as PlayoffBracket);
                }
            }
        }


        await writeDb(db);
        return { success: true };

    } catch (e: any) {
        console.error("Erro na importação do CSV:", e);
        return { success: false, error: e.message || "Erro inesperado durante a importação." };
    }
}


export async function clearAllSchedules(): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();

        const resetSchedule = (match: MatchWithScore | PlayoffMatch) => {
            match.time = '';
            match.court = '';
        };

        const resetBracketSchedules = (bracket?: PlayoffBracket) => {
            if (!bracket) return;
            Object.values(bracket).flat().forEach(resetSchedule);
        };

        for (const categoryName in db) {
            if (categoryName === '_globalSettings') continue;
            const category = db[categoryName] as CategoryData;

            // Reset group matches
            category.tournamentData?.groups.forEach(group => {
                group.matches.forEach(resetSchedule);
            });

            // Reset playoff matches
            if (category.playoffs) {
                const playoffs = category.playoffs as PlayoffBracketSet;
                if (playoffs.upper || playoffs.lower || playoffs.playoffs) {
                    resetBracketSchedules(playoffs.upper);
                    resetBracketSchedules(playoffs.lower);
                    resetBracketSchedules(playoffs.playoffs);
                } else {
                    resetBracketSchedules(playoffs as PlayoffBracket);
                }
            }
        }

        await writeDb(db);
        return { success: true };

    } catch (e: any) {
        console.error("Erro ao limpar agendamento:", e);
        return { success: false, error: e.message || "Erro inesperado ao limpar agendamento." };
    }
}

function transformDataForScheduler(tournaments: TournamentsState): { matchesInput: MatchRow[], parameters: Record<string, string> } {
    const matchesInput: MatchRow[] = [];
    const parameters: Record<string, string> = {};
    const groupMatchIds = new Map<string, string[]>(); // Key: categoryPrefix-groupName, Value: [matchId1, matchId2, ...]

    const { _globalSettings } = tournaments;

    parameters['estimatedMatchDuration'] = String(_globalSettings.estimatedMatchDuration);
    parameters['endTime'] = _globalSettings.endTime || "21:00";
    
    _globalSettings.courts.forEach((court, courtIndex) => {
        parameters[`court_${courtIndex}_name`] = court.name;
    
        court.slots.forEach((slot, slotIndex) => {
            parameters[`court_${courtIndex}_slot_${slotIndex}`] = `${slot.startTime}-${slot.endTime}`;
        });
    });

    for (const categoryName in tournaments) {
        if (categoryName === '_globalSettings') continue;
        const categoryData = tournaments[categoryName] as CategoryData;
        
        const categoryPrefix = categoryName.replace(/\s/g, '');

        parameters[`${categoryName}__startTime`] = categoryData.formValues.startTime || _globalSettings.startTime || "08:00";
        parameters[`${categoryName}__playoffPriority`] = String(categoryData.formValues.playoffPriority || 999);
        if (categoryData.formValues.quarterFinalsStartTime) parameters[`${categoryName}__stageMinTime_Quartas de Final`] = categoryData.formValues.quarterFinalsStartTime;
        if (categoryData.formValues.semiFinalsStartTime) parameters[`${categoryName}__stageMinTime_Semifinal`] = categoryData.formValues.semiFinalsStartTime;
        if (categoryData.formValues.finalStartTime) {
             parameters[`${categoryName}__stageMinTime_Final`] = categoryData.formValues.finalStartTime;
             parameters[`${categoryName}__stageMinTime_Disputa de 3º Lugar`] = categoryData.formValues.finalStartTime;
        }

        // First pass: collect all group match IDs
        categoryData.tournamentData?.groups.forEach(g => {
            const groupIdentifier = `${categoryPrefix}-${g.name.replace(/\s/g, '')}`;
            const ids = g.matches.map(m => m.id!);
            groupMatchIds.set(groupIdentifier, ids);
        });

        const addMatch = (match: MatchWithScore | PlayoffMatch, stage: string, category: string) => {
            if (!match.id) return;
            let allDependencies: string[] = [];

            const processPlaceholder = (placeholder?: string) => {
                if (!placeholder) return;
                const { matchDeps, groupDeps } = extractDependencies(placeholder);
                
                matchDeps.forEach(dep => allDependencies.push(dep));
                
                groupDeps.forEach(groupDep => {
                    if (groupMatchIds.has(groupDep)) {
                        allDependencies.push(...(groupMatchIds.get(groupDep) || []));
                    }
                });
            };

            processPlaceholder(match.team1Placeholder);
            processPlaceholder(match.team2Placeholder);
           
            matchesInput.push({
                matchId: match.id,
                category: category,
                stage: stage,
                team1: match.team1Placeholder || teamToKey(match.team1) || '',
                team2: match.team2Placeholder || teamToKey(match.team2) || '',
                dependencies: [...new Set(allDependencies)]
            });
        };

        categoryData.tournamentData?.groups.forEach(g => g.matches.forEach(m => addMatch(m, g.name, categoryName)));
        
        const processBracket = (bracket?: PlayoffBracket, catName?: string) => {
            if (!bracket || !catName) return;
            Object.values(bracket).flat().forEach(m => addMatch(m, m.name, catName));
        };

        if (categoryData.playoffs) {
            const playoffs = categoryData.playoffs as PlayoffBracketSet;
            if (playoffs.upper || playoffs.lower || playoffs.playoffs) {
                processBracket(playoffs.upper, categoryName);
                processBracket(playoffs.lower, categoryName);
                processBracket(playoffs.playoffs, categoryName);
            } else {
                processBracket(playoffs as PlayoffBracket, categoryName);
            }
        }
    }

    return { matchesInput, parameters };
}


export async function generateScheduleAction(): Promise<{ success: boolean; error?: string; logs?: SchedulingLog[]; partialSchedule?: any[] }> {
    try {
        const db = await readDb();
        
        const { matchesInput, parameters } = transformDataForScheduler(db);

        const { scheduled, unscheduled, logs, partialSchedule } = scheduleMatches(matchesInput, parameters);
        
        if (unscheduled.length > 0) {
            const errorMessage = `${unscheduled.length} jogos não puderam ser agendados. Verifique o log para mais detalhes.`;
            return { success: false, error: errorMessage, logs, partialSchedule };
        }

        const updatedMatches: UpdateMatchInputType[] = scheduled
            .filter(m => m.id && m.time && m.court)
            .map(m => ({
                matchId: m.id!,
                categoryName: m.category,
                time: m.time!,
                court: m.court!
        }));
        
        await updateMultipleMatches(updatedMatches);
        return { success: true };

    } catch (e: any) {
        console.error("Erro ao gerar horários:", e);
        return { success: false, error: e.message || "Erro desconhecido ao gerar horários." };
    }
}

    
