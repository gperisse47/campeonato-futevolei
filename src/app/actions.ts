
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

type SchedulableMatch = (MatchWithScore | PlayoffMatch) & {
    category: string;
    id: string; // Ensure id is always present
    groupName?: string;
    players: string[];
    stage: string;
};

function getPlayersFromMatch(match: MatchWithScore | PlayoffMatch): string[] {
    const players = new Set<string>();
    const addTeamPlayers = (team?: Team | string) => {
        if (!team) return;
        if (typeof team === 'string') {
            if(team.includes(' e ')) {
                team.split(' e ').forEach(p => players.add(p.trim()));
            }
        } else {
             if (team.player1) players.add(team.player1.trim());
             if (team.player2) players.add(team.player2.trim());
        }
    };
    addTeamPlayers(match.team1);
    addTeamPlayers(match.team2);
    // Add players from placeholders too if teams are not yet defined
    if (!match.team1 && match.team1Placeholder) addTeamPlayers(match.team1Placeholder);
    if (!match.team2 && match.team2Placeholder) addTeamPlayers(match.team2Placeholder);
    return Array.from(players);
}

function extractDependencies(placeholder: string | undefined, categoryName: string): string[] {
    if (!placeholder) return [];
    
    // For "Vencedor Categoria-QuartasdeFinal-Jogo1" or "Perdedor Categoria-U-R1-J1"
    const matchDepMatch = placeholder.match(/(?:Vencedor|Perdedor)\s(.+)/);
    if (matchDepMatch && matchDepMatch[1]) {
        return [matchDepMatch[1].trim()];
    }
    
    // For "1º do Categoria-GroupA"
    const groupDepMatch = placeholder.match(/\d+º\sdo\s(.+)/);
    if (groupDepMatch && groupDepMatch[1]) {
        return [`${groupDepMatch[1].trim()}-finished`];
    }

    return [];
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
};

export async function updateMatch(input: UpdateMatchInput): Promise<{ success: boolean; error?: string }> {
    try {
        const { matchId, categoryName, time, court } = input;
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
                    const match = round.find(m => m.id === matchId);
                    if (match) {
                        match.time = time;
                        match.court = court;
                        matchFound = true;
                        return;
                    }
                }
            };
            
            const bracketSet = categoryData.playoffs as PlayoffBracketSet;
            if(bracketSet.upper || bracketSet.lower || bracketSet.playoffs) {
                findAndUpdateInBracket(bracketSet.upper);
                if (!matchFound) findAndUpdateInBracket(bracketSet.lower);
                if (!matchFound) findAndUpdateInBracket(bracketSet.playoffs);
            } else {
                findAndUpdateInBracket(bracketSet as PlayoffBracket)
            }
        }


        if (!matchFound) {
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

// --- Scheduler with Constraints ---

interface SchedulerMatchRow {
    matchId: string;
    category: string;
    stage: string;
    team1: string;
    team2: string;
}

class SchedulerCourt {
    name: string;
    slots: { start: Date; end: Date; }[];
    nextAvailable: Date = new Date(0);

    constructor(name: string, slots: { startTime: string; endTime: string; }[]) {
        this.name = name;
        this.slots = slots.map(({ startTime, endTime }) => ({
            start: parseTime(startTime),
            end: parseTime(endTime)
        }));
    }
}

class SchedulerMatch {
    id: string;
    category: string;
    group: string;
    team1: string;
    team2: string;
    stage: string;
    players: string[];
    time?: string;
    court?: string;

    constructor(row: SchedulerMatchRow) {
        this.id = row.matchId;
        this.category = row.category;
        this.group = row.stage;
        this.team1 = row.team1;
        this.team2 = row.team2;
        this.stage = this.normalizeStageName(row.stage);
        this.players = this.extractPlayers(this.team1).concat(this.extractPlayers(this.team2));
    }

    private extractPlayers(team: string): string[] {
        if (!team) return [];
        return team.split(/\s+e\s+/).map(p => p.trim());
    }

    private normalizeStageName(stage: string): string {
        if (!stage) return "desconhecido";
        stage = stage.trim().toLowerCase();
        if (stage.includes("grupo") || stage.includes("group")) return "grupos";
        if (stage.includes("oitava")) return "oitavas";
        if (stage.includes("quart")) return "quartas";
        if (stage.includes("semi")) return "semifinal";
        if (stage.includes("final") && stage.includes("3")) return "3º lugar";
        if (stage.includes("final")) return "final";
        return stage;
    }
}

function runScheduler(matchesInput: SchedulerMatchRow[], db: TournamentsState): SchedulerMatch[] {
    const { _globalSettings } = db;
    const matchDurationMin = _globalSettings.estimatedMatchDuration || 20;

    const courts: SchedulerCourt[] = _globalSettings.courts.map(c => new SchedulerCourt(c.name, c.slots));

    const startTimes: Record<string, Date> = {};
    Object.entries(db).forEach(([key, value]) => {
        if (key !== '_globalSettings') {
            const catData = value as CategoryData;
            startTimes[key] = parseTime(catData.formValues.startTime || _globalSettings.startTime);
        }
    });

    const STAGE_ORDER = ["grupos", "oitavas", "quartas", "semifinal", "final", "3º lugar"];
    const stagePriority = Object.fromEntries(STAGE_ORDER.map((s, i) => [s, i]));

    const matches = matchesInput.map(row => new SchedulerMatch(row));
    const matchesByCatStage: Record<string, Record<string, SchedulerMatch[]>> = {};
    for (const match of matches) {
        if (!matchesByCatStage[match.category]) matchesByCatStage[match.category] = {};
        if (!matchesByCatStage[match.category][match.stage]) matchesByCatStage[match.category][match.stage] = [];
        matchesByCatStage[match.category][match.stage].push(match);
    }

    const stagesPerCat: Record<string, string[]> = {};
    const currentStageIdx: Record<string, number> = {};
    for (const cat in matchesByCatStage) {
        const stages = Object.keys(matchesByCatStage[cat]).sort((a, b) => (stagePriority[a] ?? 99) - (stagePriority[b] ?? 99));
        stagesPerCat[cat] = stages;
        currentStageIdx[cat] = 0;
    }

    const END_OF_DAY = parseTime(_globalSettings.endTime || "21:00");
    let currentTime = new Date(Math.min(...Object.values(startTimes).map(d => d.getTime())));
    const unscheduled = new Set(matches.map(m => m.id));

    const playerAvailability: Record<string, Date> = {};
    const matchHistory: Record<string, Date[]> = {};

    function playedTwoConsecutive(player: string, time: Date): boolean {
        const times = (matchHistory[player] || []).filter(t => t < time).sort((a, b) => a.getTime() - b.getTime());
        if (times.length < 2) return false;
        const last = times[times.length - 1];
        const secondLast = times[times.length - 2];
        return isEqual(last, addMinutes(time, -matchDurationMin)) && isEqual(secondLast, addMinutes(time, -2 * matchDurationMin));
    }

    let iterations = 0;
    while (unscheduled.size > 0 && iterations++ < 5000) {
        if (addMinutes(currentTime, matchDurationMin) > END_OF_DAY) break;
        
        const availableCourts = courts.filter(c => 
            c.slots.some(({ start, end }) => {
                const matchEnd = addMinutes(currentTime, matchDurationMin);
                return currentTime >= start && matchEnd <= end;
            }) && c.nextAvailable <= currentTime
        );

        const readyMatches: SchedulerMatch[] = [];
        for (const cat in matchesByCatStage) {
            if (currentTime < startTimes[cat]) continue;
            const stageIdx = currentStageIdx[cat];
            if (stageIdx >= stagesPerCat[cat].length) continue;
            const stage = stagesPerCat[cat][stageIdx];
            const stageMatches = (matchesByCatStage[cat][stage] || []).filter(m => unscheduled.has(m.id));
            for (const m of stageMatches) {
                if (m.players.every(p => (playerAvailability[p] || new Date(0)) <= currentTime) &&
                    m.players.every(p => !playedTwoConsecutive(p, currentTime))) {
                    readyMatches.push(m);
                }
            }
        }

        readyMatches.sort((a, b) => {
            const rest = (m: SchedulerMatch) => {
                const rests = m.players.map(p => differenceInMinutes(currentTime, playerAvailability[p] || new Date(0)));
                return { min: Math.min(...rests), sum: rests.reduce((a, b) => a + b, 0) };
            };
            const ar = rest(a); const br = rest(b);
            return ar.min - br.min || ar.sum - br.sum;
        });

        let scheduledThisTick = false;
        const usedPlayersThisTick = new Set<string>();

        for (const court of availableCourts) {
            const match = readyMatches.find(m => m.players.every(p => !usedPlayersThisTick.has(p)));
            if (!match) continue;

            match.time = format(currentTime, 'HH:mm');
            match.court = court.name;
            court.nextAvailable = addMinutes(currentTime, matchDurationMin);
            for (const p of match.players) {
                playerAvailability[p] = addMinutes(currentTime, matchDurationMin);
                matchHistory[p] = [...(matchHistory[p] || []), new Date(currentTime.getTime())];
                usedPlayersThisTick.add(p);
            }
            unscheduled.delete(match.id);
            scheduledThisTick = true;

            const { category, stage } = match;
            if (matchesByCatStage[category][stage].every(m => !unscheduled.has(m.id))) {
                if (currentStageIdx[category] < stagesPerCat[category].length - 1) {
                    currentStageIdx[category]++;
                }
            }
        }

        if (!scheduledThisTick) {
            let nextCourtTime = new Date(Math.min(...courts.map(c => c.nextAvailable.getTime() > currentTime.getTime() ? c.nextAvailable.getTime() : Infinity)));
            if (isFinite(nextCourtTime.getTime())) {
                 currentTime = nextCourtTime;
            } else {
                 currentTime = addMinutes(currentTime, 5);
            }
        }
    }

    return matches.filter(m => m.time);
}

export async function generateScheduleAction(): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();
        const allMatchesInput: SchedulerMatchRow[] = [];

        const teamName = (team: Team | undefined, placeholder: string | undefined): string => {
            if (team?.player1 && team?.player2) return `${team.player1} e ${team.player2}`;
            return placeholder || "A Definir";
        };

        Object.entries(db).forEach(([categoryName, categoryData]) => {
            if (categoryName === '_globalSettings') return;
            const cat = categoryData as CategoryData;

            const addMatches = (matches: (MatchWithScore | PlayoffMatch)[], stageOverride?: string) => {
                matches.forEach(match => {
                    if (!match.id) return;
                    allMatchesInput.push({
                        matchId: match.id,
                        category: categoryName,
                        stage: stageOverride || ('name' in match ? match.name : cat.formValues.category),
                        team1: teamName(match.team1, match.team1Placeholder),
                        team2: teamName(match.team2, match.team2Placeholder)
                    });
                });
            };

            cat.tournamentData?.groups.forEach(group => addMatches(group.matches, group.name));

            const playoffs = cat.playoffs as PlayoffBracketSet;
            const processBracket = (bracket?: PlayoffBracket) => {
                if (!bracket) return;
                Object.values(bracket).flat().forEach(match => {
                    if (!match.id) return;
                    allMatchesInput.push({
                        matchId: match.id,
                        category: categoryName,
                        stage: match.name,
                        team1: teamName(match.team1, match.team1Placeholder),
                        team2: teamName(match.team2, match.team2Placeholder),
                    });
                });
            };

            if (playoffs) {
              if ('upper' in playoffs || 'lower' in playoffs || 'playoffs' in playoffs) {
                  processBracket(playoffs.upper);
                  processBracket(playoffs.lower);
                  processBracket(playoffs.playoffs);
              } else {
                  processBracket(playoffs as PlayoffBracket);
              }
            }
        });

        const scheduledMatches = runScheduler(allMatchesInput, db);

        if (scheduledMatches.length < allMatchesInput.length) {
            const unscheduledCount = allMatchesInput.length - scheduledMatches.length;
            return { success: false, error: `${unscheduledCount} jogos não puderam ser agendados.` };
        }

        const updatedMatches: UpdateMatchInputType[] = scheduledMatches.map(m => ({
            matchId: m.id,
            categoryName: m.category,
            time: m.time || '',
            court: m.court || ''
        }));

        return updateMultipleMatches(updatedMatches);
    } catch (e: any) {
        console.error("Erro ao gerar horários:", e);
        return { success: false, error: e.message || "Erro desconhecido ao gerar horários." };
    }
}


    

    

    