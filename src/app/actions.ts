
"use server"
import 'dotenv/config';

import fs from "fs/promises"
import path from "path"
import {
  generateTournamentGroups,
  type GenerateTournamentGroupsOutput
} from "@/ai/flows/generate-tournament-groups"
import type { TournamentsState, CategoryData, GlobalSettings, Team, PlayoffBracket, PlayoffBracketSet, GenerateTournamentGroupsInput, PlayoffMatch, MatchWithScore, Court, TournamentFormValues, GroupWithScores } from "@/lib/types"
import { z } from 'zod';
import { format, addMinutes, parse, isBefore, startOfDay, isAfter } from 'date-fns';
import { calculateTotalMatches, initializeDoubleEliminationBracket, initializePlayoffs, initializeStandings } from '@/lib/regeneration';


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
    const date = new Date(baseDate);
    date.setHours(h, m, 0, 0);
    return date;
};

type SchedulableMatch = (MatchWithScore & { category: string, groupName?: string }) | (PlayoffMatch & { category: string });

const getPlayersFromMatch = (match: SchedulableMatch, matchPlayerMap: Map<string, string[]>): string[] => {
    const matchId = getMatchId(match);
    return matchPlayerMap.get(matchId) || [];
};

const getMatchId = (match: SchedulableMatch): string => {
    if ('id' in match && match.id) return match.id;
    // For group matches, create a stable ID based on teams and category/group
    if ('groupName' in match && match.groupName && 'team1' in match && 'team2' in match) {
      const team1Key = teamToKey(match.team1).replace(/\s/g, '');
      const team2Key = teamToKey(match.team2).replace(/\s/g, '');
      const sortedKeys = [team1Key, team2Key].sort();
      return `${match.category}-${match.groupName}-${sortedKeys[0]}-vs-${sortedKeys[1]}`;
    }
    // Fallback for safety, though should not be reached with proper data
    return `${match.category}-${Math.random()}`;
};

export async function rescheduleAllTournaments(): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();
        const { _globalSettings } = db;
        if (!_globalSettings?.courts || _globalSettings.courts.length === 0) {
            return { success: false, error: "Nenhuma quadra configurada." };
        }

        const matchDuration = _globalSettings.estimatedMatchDuration;
        
        // --- 1. Data Preparation ---
        let allMatches: SchedulableMatch[] = [];
        const matchPlayerMap = new Map<string, string[]>();
        const playerAvailability = new Map<string, Date>();
        const categoryStartTimeMap = new Map<string, Date>();
        const matchDependencyMap = new Map<string, string[]>(); // matchId -> [dependencyId1, dependencyId2]
        const dependencyToMatchMap = new Map<string, string[]>(); // dependencyId -> [matchId1, matchId2]
        const groupMatchCounts = new Map<string, number>();

        Object.entries(db).forEach(([category, catData]) => {
            if (category === '_globalSettings') return;
            const categoryTyped = catData as CategoryData;
            
            const startTime = parseTime(categoryTyped.formValues.startTime || _globalSettings.startTime);
            categoryStartTimeMap.set(category, startTime);
            
            const clearSchedule = (m: any): SchedulableMatch => ({ ...m, time: '', court: '', category });

            // Collect Group Matches
            categoryTyped.tournamentData?.groups.forEach(group => {
                const groupDepKey = `${category}-${group.name}-finished`;
                groupMatchCounts.set(groupDepKey, group.matches.length);

                group.matches.forEach(match => {
                    const schedulableMatch: SchedulableMatch = { ...clearSchedule(match), groupName: group.name };
                    const matchId = getMatchId(schedulableMatch);
                    schedulableMatch.id = matchId;
                    allMatches.push(schedulableMatch);

                    const players = (match.team1 && match.team2) ? [match.team1.player1, match.team1.player2, match.team2.player1, match.team2.player2].filter(Boolean) : [];
                    matchPlayerMap.set(matchId, players);
                    players.forEach(p => { if (!playerAvailability.has(p)) playerAvailability.set(p, new Date(0)); });
                    
                    matchDependencyMap.set(matchId, []); // Group matches have no dependencies
                });
            });

            // Collect and Map Playoff Matches and their Dependencies
            const processBracket = (bracket: PlayoffBracket | undefined) => {
                if (!bracket) return;
                Object.values(bracket).flat().forEach(match => {
                    const schedulableMatch: SchedulableMatch = { ...clearSchedule(match) };
                    allMatches.push(schedulableMatch);
                    matchPlayerMap.set(match.id, []); // Players are initially unknown
                    
                    const dependencies = new Set<string>();
                    [match.team1Placeholder, match.team2Placeholder].forEach(p => {
                        const winnerMatch = p?.match(/Vencedor (.+)/);
                        if (winnerMatch?.[1]) dependencies.add(winnerMatch[1].trim());

                        const loserMatch = p?.match(/Perdedor (.+)/);
                        if (loserMatch?.[1]) dependencies.add(loserMatch[1].trim());
                        
                        const groupMatch = p?.match(/\d+º do (.+)/);
                        if (groupMatch?.[1]) dependencies.add(`${category}-${groupMatch[1].trim()}-finished`);
                    });

                    const depsArray = Array.from(dependencies);
                    matchDependencyMap.set(match.id, depsArray);

                    depsArray.forEach(dep => {
                        if (!dependencyToMatchMap.has(dep)) dependencyToMatchMap.set(dep, []);
                        dependencyToMatchMap.get(dep)!.push(match.id);
                    });
                });
            };

            const bracketSet = categoryTyped.playoffs as PlayoffBracketSet;
            if (bracketSet) {
                processBracket(bracketSet.upper);
                processBracket(bracketSet.lower);
                processBracket(bracketSet.playoffs);
                processBracket(bracketSet as PlayoffBracket); // For single elim
            }
        });
        
        // --- 2. Scheduling ---
        const matchQueue: SchedulableMatch[] = allMatches.filter(m => (matchDependencyMap.get(getMatchId(m)) || []).length === 0);
        const scheduledMatches = new Map<string, SchedulableMatch>();
        const dependencyFinishTimes = new Map<string, Date>();
        
        const sortedCourts = [..._globalSettings.courts].sort((a, b) => (a.priority || 99) - (b.priority || 99));
        const courtAvailability: Map<string, Date> = new Map(sortedCourts.map(c => [c.name, new Date(0)]));
        
        while (matchQueue.length > 0) {
            // Sort queue by earliest possible start time
            matchQueue.sort((a, b) => {
                const playersA = getPlayersFromMatch(a, matchPlayerMap);
                const lastPlayerTimeA = new Date(Math.max(0, ...playersA.map(p => (playerAvailability.get(p) || new Date(0)).getTime())));
                const catTimeA = categoryStartTimeMap.get(a.category)!;
                const startTimeA = new Date(Math.max(lastPlayerTimeA.getTime(), catTimeA.getTime()));

                const playersB = getPlayersFromMatch(b, matchPlayerMap);
                const lastPlayerTimeB = new Date(Math.max(0, ...playersB.map(p => (playerAvailability.get(p) || new Date(0)).getTime())));
                const catTimeB = categoryStartTimeMap.get(b.category)!;
                const startTimeB = new Date(Math.max(lastPlayerTimeB.getTime(), catTimeB.getTime()));

                return startTimeA.getTime() - startTimeB.getTime();
            });

            const matchToSchedule = matchQueue.shift()!;
            const matchId = getMatchId(matchToSchedule);

            const players = getPlayersFromMatch(matchToSchedule, matchPlayerMap);
            const categoryStart = categoryStartTimeMap.get(matchToSchedule.category)!;
            const lastPlayerFinishTime = new Date(Math.max(0, ...players.map(p => (playerAvailability.get(p) || new Date(0)).getTime())));
            
            let bestCourt: Court | null = null;
            let bestTime: Date | null = null;
            
            // Find the earliest slot this match can be played in
            for(const court of sortedCourts) {
                const courtFreeTime = courtAvailability.get(court.name) || new Date(0);
                const earliestStartTime = new Date(Math.max(
                    categoryStart.getTime(),
                    lastPlayerFinishTime.getTime(),
                    courtFreeTime.getTime()
                ));

                if (!bestTime || isBefore(earliestStartTime, bestTime)) {
                    bestTime = earliestStartTime;
                    bestCourt = court;
                }
            }

            if (bestTime && bestCourt) {
                const endTime = addMinutes(bestTime, matchDuration);
                
                // Update the original match object in the db
                const originalMatch = allMatches.find(m => getMatchId(m) === matchId)!;
                originalMatch.time = format(bestTime, 'HH:mm');
                originalMatch.court = bestCourt.name;

                courtAvailability.set(bestCourt.name, endTime);
                players.forEach(p => playerAvailability.set(p, endTime));
                
                scheduledMatches.set(matchId, originalMatch);
                dependencyFinishTimes.set(matchId, endTime);

                // --- Dependency Resolution ---
                // Check if a group is finished
                if ('groupName' in matchToSchedule && matchToSchedule.groupName) {
                    const groupDepKey = `${matchToSchedule.category}-${matchToSchedule.groupName}-finished`;
                    const count = (groupMatchCounts.get(groupDepKey) || 0) - 1;
                    groupMatchCounts.set(groupDepKey, count);

                    if (count === 0) {
                        dependencyFinishTimes.set(groupDepKey, endTime);
                        const unlockedMatchIds = dependencyToMatchMap.get(groupDepKey) || [];
                        unlockedMatchIds.forEach(unlockedId => {
                            const deps = matchDependencyMap.get(unlockedId)!;
                            if(deps.every(d => dependencyFinishTimes.has(d))) {
                                const unlockedMatch = allMatches.find(m => getMatchId(m) === unlockedId);
                                if(unlockedMatch) matchQueue.push(unlockedMatch);
                            }
                        });
                    }
                }
                
                // Check for unlocked playoff matches
                const unlockedByThisMatch = dependencyToMatchMap.get(matchId) || [];
                unlockedByThisMatch.forEach(unlockedId => {
                    const deps = matchDependencyMap.get(unlockedId)!;
                     if(deps.every(d => dependencyFinishTimes.has(d))) {
                        const unlockedMatch = allMatches.find(m => getMatchId(m) === unlockedId);
                        if(unlockedMatch) matchQueue.push(unlockedMatch);
                    }
                });

            } else {
                 console.error(`Could not schedule match: ${matchId}`);
                 const originalMatch = allMatches.find(m => getMatchId(m) === matchId)!;
                 originalMatch.time = "N/A";
                 originalMatch.court = "N/A";
                 scheduledMatches.set(matchId, originalMatch);
            }
        }
        
        await writeDb(db);
        return { success: true };
    } catch (e: any) {
        console.error("Erro no agendamento:", e, e.stack);
        return { success: false, error: e.message || "Erro inesperado durante o agendamento." };
    }
}


function teamIsEqual(teamA?: Team, teamB?: Team) {
    if (!teamA || !teamB) return false;
    if(!teamA.player1 || !teamA.player2 || !teamB.player1 || !teamB.player2) return false;
    const teamAPlayers = [teamA.player1, teamA.player2].sort();
    const teamBPlayers = [teamB.player1, teamB.player2].sort();
    return teamAPlayers[0] === teamBPlayers[0] && teamAPlayers[1] === teamBPlayers[1];
}

const teamToKey = (team?: Team): string => {
    if (!team || !team.player1 || !team.player2) return '';
    const players = [team.player1.trim(), team.player2.trim()].sort();
    return `${players[0]} e ${players[1]}`;
};

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
        const oldCategoryData = db[values.category] || {};

        let newCategoryData: CategoryData = {
            ...oldCategoryData,
            tournamentData: null,
            playoffs: null,
            formValues: values,
        };

        if (values.tournamentType === 'doubleElimination') {
            const finalPlayoffs = await initializeDoubleEliminationBracket(values);
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
                const initializedGroups = await initializeStandings(result.data.groups);
                // Assign dependencies to playoff matches that depend on groups
                const initializedPlayoffs = await initializePlayoffs(values, result.data);

                newCategoryData.tournamentData = { groups: initializedGroups };
                newCategoryData.playoffs = initializedPlayoffs;

            } else if (values.tournamentType === 'singleElimination') {
                newCategoryData.playoffs = await initializePlayoffs(values, result.data);
            }
        }
        
        newCategoryData.totalMatches = await calculateTotalMatches(newCategoryData);
        
        db[values.category] = newCategoryData;
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



    
