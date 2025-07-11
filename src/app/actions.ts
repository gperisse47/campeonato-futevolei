
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
import { format, addMinutes, parse, isBefore, isEqual, startOfDay, isAfter } from 'date-fns';
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
        return new Date(0);
    }
    const [h, m] = timeStr.split(':').map(Number);
    const date = new Date(baseDate);
    date.setHours(h, m, 0, 0);
    return date;
};


const teamToKey = (team?: Team) => {
    if (!team || !team.player1 || !team.player2) return '';
    return `${team.player1}-${team.player2}`.trim().toLowerCase();
};


const getPlayersFromMatch = (match: MatchWithScore | PlayoffMatch): string[] => {
    const players = new Set<string>();
    if (match.team1) {
        if (match.team1.player1) players.add(match.team1.player1);
        if (match.team1.player2) players.add(match.team1.player2);
    }
    if (match.team2) {
        if (match.team2.player1) players.add(match.team2.player1);
        if (match.team2.player2) players.add(match.team2.player2);
    }
    return Array.from(players);
};

const extractDependencies = (placeholder: string): string[] => {
    const matches = placeholder.match(/(Vencedor|Perdedor)\s(.+)/);
    if (matches && matches[2]) {
        return [matches[2].trim()];
    }
    const groupMatches = placeholder.match(/\d+º\sdo\s(Grupo\s\w)/);
    if(groupMatches && groupMatches[1]){
        return [groupMatches[1].trim()];
    }
    return [];
};


export async function rescheduleAllTournaments(): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();
        const { _globalSettings } = db;
        if (!_globalSettings?.courts || _globalSettings.courts.length === 0) {
            return { success: false, error: "Nenhuma quadra configurada." };
        }

        const matchDuration = _globalSettings.estimatedMatchDuration;
        const sortedCourts = [..._globalSettings.courts].sort((a, b) => (a.priority || 99) - (b.priority || 99));
        
        let allMatchesToSchedule: (MatchWithScore | PlayoffMatch)[] = [];
        const matchCategoryMap = new Map<string, string>();
        const categoryStartTimeMap = new Map<string, Date>();
        const groupFinishTimes = new Map<string, Date>(); // Map<groupName, finishTime>
        const playoffMatchFinishTimes = new Map<string, Date>(); // Map<matchId, finishTime>

        // 1. Gather all matches and their metadata
        Object.keys(db).filter(k => k !== '_globalSettings').forEach(catName => {
            const catData = db[catName] as CategoryData;
            categoryStartTimeMap.set(catName, parseTime(catData.formValues.startTime || _globalSettings.startTime));
            
            // Clear existing schedules
            const clearSchedule = (match: MatchWithScore | PlayoffMatch) => {
                match.time = '';
                match.court = '';
                return match;
            };

            if (catData.tournamentData?.groups) {
                catData.tournamentData.groups.forEach(g => g.matches.forEach(m => {
                    const match = clearSchedule(m);
                    allMatchesToSchedule.push(match);
                    matchCategoryMap.set(`${teamToKey(m.team1)}-${teamToKey(m.team2)}`, catName);
                }));
            }
            if (catData.playoffs) {
                 const processBracket = (bracket: PlayoffBracket | undefined) => {
                    if (!bracket) return;
                    Object.values(bracket).flat().forEach(m => {
                       const match = clearSchedule(m);
                       allMatchesToSchedule.push(match);
                       matchCategoryMap.set(m.id, catName);
                    });
                };
                const bracketSet = catData.playoffs as PlayoffBracketSet;
                processBracket(bracketSet.upper);
                processBracket(bracketSet.lower);
                processBracket(bracketSet.playoffs);
                 if (!bracketSet.upper && !bracketSet.lower) { // Handle single elimination
                    processBracket(bracketSet as PlayoffBracket);
                 }
            }
        });
        
        // Main scheduling loop
        let scheduledMatchesCount = 0;
        const totalMatches = allMatchesToSchedule.length;
        const playerAvailability = new Map<string, Date>(); // Map<playerName, availableTime>
        const courtAvailability: Date[] = Array(sortedCourts.length).fill(new Date(0));
        let currentTime = parseTime(_globalSettings.startTime);
        
        const unscheduledMatches = new Set(allMatchesToSchedule);

        while (unscheduledMatches.size > 0) {
            let scheduledInThisSlot = false;
            
            const freeCourtsIndices = sortedCourts
                .map((_, i) => i)
                .filter(i => !isAfter(courtAvailability[i], currentTime));

            if (freeCourtsIndices.length > 0) {
                const schedulableMatches = Array.from(unscheduledMatches).filter(match => {
                    const categoryName = matchCategoryMap.get('id' in match ? match.id : `${teamToKey(match.team1)}-${teamToKey(match.team2)}`);
                    if (!categoryName) return false;

                    // Check if category can start
                    if (isAfter(categoryStartTimeMap.get(categoryName)!, currentTime)) {
                        return false;
                    }

                    // Check dependencies for playoff matches
                    if ('dependencies' in match && Array.isArray(match.dependencies)) {
                        for (const dep of match.dependencies) {
                            const finishTime = groupFinishTimes.get(dep) || playoffMatchFinishTimes.get(dep);
                            if (!finishTime || isAfter(finishTime, currentTime)) {
                                return false; // Dependency not met
                            }
                        }
                    }
                    
                    const players = getPlayersFromMatch(match);
                    if (players.length === 0 && 'team1Placeholder' in match) { // Playoff match with unresolved teams
                        return false;
                    }

                    // Check player availability
                    return players.every(p => !isAfter(playerAvailability.get(p) || new Date(0), currentTime));
                });
                
                // Sort by who has rested the most
                schedulableMatches.sort((a, b) => {
                     const getWorstRestTime = (match: MatchWithScore | PlayoffMatch) => {
                        const players = getPlayersFromMatch(match);
                        if(players.length === 0) return currentTime.getTime();
                        const lastPlayedTimes = players.map(p => (playerAvailability.get(p) || new Date(0)).getTime());
                        return Math.max(...lastPlayedTimes);
                    };
                    return getWorstRestTime(a) - getWorstRestTime(b);
                });
                
                const playersScheduledInThisSlot = new Set<string>();

                for (const match of schedulableMatches) {
                    const courtIndex = freeCourtsIndices.find(i => {
                        const court = sortedCourts[i];
                        const isCourtOpen = court.slots.some(slot => 
                            !isBefore(currentTime, parseTime(slot.startTime)) &&
                            isBefore(addMinutes(currentTime, matchDuration), parseTime(slot.endTime))
                        );
                        return isCourtOpen && !isAfter(courtAvailability[i], currentTime);
                    });

                    if (courtIndex === undefined) continue;

                    const players = getPlayersFromMatch(match);
                    if (players.some(p => playersScheduledInThisSlot.has(p))) {
                        continue; // Player already scheduled in this time slot
                    }
                    
                    const matchEndTime = addMinutes(currentTime, matchDuration);
                    match.time = format(currentTime, 'HH:mm');
                    match.court = sortedCourts[courtIndex].name;
                    courtAvailability[courtIndex] = matchEndTime;
                    
                    players.forEach(p => {
                        playerAvailability.set(p, matchEndTime);
                        playersScheduledInThisSlot.add(p);
                    });
                    
                    // Update dependency finish times
                    if ('name' in match && match.name.startsWith('Group')) {
                        const groupName = match.name;
                        const currentFinish = groupFinishTimes.get(groupName) || new Date(0);
                        if(isAfter(matchEndTime, currentFinish)){
                            groupFinishTimes.set(groupName, matchEndTime);
                        }
                    } else if ('id' in match) {
                        playoffMatchFinishTimes.set(match.id, matchEndTime);
                    }

                    unscheduledMatches.delete(match);
                    scheduledInThisSlot = true;
                }
            }

            if (!scheduledInThisSlot) {
                const nextCourtFreeTime = Math.min(...courtAvailability.map(t => t.getTime()));
                const nextPlayerFreeTimes = Array.from(playerAvailability.values()).map(t => t.getTime());
                const allFutureTimes = [nextCourtFreeTime, ...nextPlayerFreeTimes].filter(t => isAfter(new Date(t), currentTime));

                if (allFutureTimes.length > 0) {
                     currentTime = new Date(Math.min(...allFutureTimes));
                } else {
                    currentTime = addMinutes(currentTime, matchDuration);
                }
                 // Align to grid
                 const minutes = currentTime.getMinutes();
                 const remainder = minutes % matchDuration;
                 if (remainder !== 0) {
                     currentTime = addMinutes(currentTime, matchDuration - remainder);
                 }
            }
        }
        
        await writeDb(db);
        return { success: true };
    } catch (e: any) {
        console.error("Error rescheduling all tournaments:", e);
        return { success: false, error: e.message || "Ocorreu um erro desconhecido ao reagendar." };
    }
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

    const originalTeamKey = `${originalTeam.player1} e ${originalTeam.player2}`;
    const updatedTeamKey = `${updatedTeam.player1} e ${updatedTeam.player2}`;

    // Helper function to update a team object
    const updateTeamObject = (team: Team) => {
        if (team.player1 === originalTeam.player1 && team.player2 === originalTeam.player2) {
            return { ...updatedTeam };
        }
        return team;
    };
    
    // Update teams in formValues.teams string
    if (categoryData.formValues.teams) {
        const teamsList = categoryData.formValues.teams.split('\n');
        const teamIndex = teamsList.findIndex(t => t.trim().replace(/\s+/g, ' ') === originalTeamKey.replace(/\s/g, ' '));
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
        group.teams = group.teams.map(updateTeamObject);

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

                if (initializedPlayoffs) {
                     const processBracket = (bracket: PlayoffBracket | undefined) => {
                        if (!bracket) return;
                        Object.values(bracket).flat().forEach(match => {
                             const deps = new Set<string>();
                             extractDependencies(match.team1Placeholder).forEach(d => deps.add(d));
                             extractDependencies(match.team2Placeholder).forEach(d => deps.add(d));
                             if(deps.size > 0) {
                                (match as any).dependencies = Array.from(deps);
                             }
                        });
                     };
                     if ('upper' in initializedPlayoffs || 'lower' in initializedPlayoffs || 'playoffs' in initializedPlayoffs) {
                        const bracketSet = initializedPlayoffs as PlayoffBracketSet;
                        processBracket(bracketSet.upper);
                        processBracket(bracketSet.lower);
                        processBracket(bracketSet.playoffs);
                     } else {
                        processBracket(initializedPlayoffs as PlayoffBracket);
                     }
                }

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
