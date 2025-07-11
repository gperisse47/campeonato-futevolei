
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

const getPlayersFromMatch = (match: SchedulableMatch): string[] => {
    const players = new Set<string>();
    if (match.team1?.player1) players.add(match.team1.player1);
    if (match.team1?.player2) players.add(match.team1.player2);
    if (match.team2?.player1) players.add(match.team2.player1);
    if (match.team2?.player2) players.add(match.team2.player2);
    return Array.from(players);
};

const extractDependencies = (placeholder: string): string[] => {
    const winnerMatch = placeholder.match(/Vencedor (.+)/);
    if (winnerMatch && winnerMatch[1]) {
        return [winnerMatch[1].trim()];
    }
    const loserMatch = placeholder.match(/Perdedor (.+)/);
    if (loserMatch && loserMatch[1]) {
        return [loserMatch[1].trim()];
    }
    const groupMatches = placeholder.match(/\d+º do (Group \w)/);
    if(groupMatches && groupMatches[1]){
        return [`${groupMatches[1].trim()}-finished`];
    }
    return [];
};


// A unique identifier for a match object
const getMatchId = (match: SchedulableMatch): string => {
    if ('id' in match && match.id) return match.id;
    // For group matches, create a stable ID based on teams and category/group
    return `${match.category}-${match.groupName}-${teamToKey(match.team1)}-vs-${teamToKey(match.team2)}`;
};

type SchedulableMatch = (MatchWithScore & { category: string, groupName?: string }) | (PlayoffMatch & { category: string });

export async function rescheduleAllTournaments(): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();
        const { _globalSettings } = db;
        if (!_globalSettings?.courts || _globalSettings.courts.length === 0) {
            return { success: false, error: "Nenhuma quadra configurada." };
        }

        const matchDuration = _globalSettings.estimatedMatchDuration;
        const sortedCourts = [..._globalSettings.courts].sort((a, b) => (a.priority || 99) - (b.priority || 99));

        // --- 1. Data Preparation ---
        let allMatchesToSchedule: SchedulableMatch[] = [];
        const categoryStartTimeMap = new Map<string, Date>();
        const matchPlayerMap = new Map<string, string[]>();
        const matchDependencyMap = new Map<string, string[]>();
        const groupMatchCounts = new Map<string, number>();

        Object.keys(db).filter(k => k !== '_globalSettings').forEach(catName => {
            const catData = db[catName] as CategoryData;
            categoryStartTimeMap.set(catName, parseTime(catData.formValues.startTime || _globalSettings.startTime));
            
            const clearSchedule = (match: any) => ({ ...match, time: '', court: '' });

            if (catData.tournamentData?.groups) {
                catData.tournamentData.groups.forEach(g => {
                    const groupKey = `${catName}-${g.name}`;
                    groupMatchCounts.set(groupKey, g.matches.length);
                    g.matches.forEach(m => {
                        const schedulableMatch: SchedulableMatch = { ...clearSchedule(m), category: catName, groupName: g.name };
                        const matchId = getMatchId(schedulableMatch);
                        allMatchesToSchedule.push(schedulableMatch);
                        matchPlayerMap.set(matchId, getPlayersFromMatch(schedulableMatch));
                    });
                });
            }

            if (catData.playoffs) {
                const processBracket = (bracket: PlayoffBracket | undefined) => {
                    if (!bracket) return;
                    Object.values(bracket).flat().forEach(m => {
                        if (!m.id) return; // Skip matches without IDs
                        const schedulableMatch: SchedulableMatch = { ...clearSchedule(m), category: catName };
                        const matchId = getMatchId(schedulableMatch);
                        allMatchesToSchedule.push(schedulableMatch);
                        const players = getPlayersFromMatch(schedulableMatch);
                        if(players.length > 0) matchPlayerMap.set(matchId, players);
                        
                        const deps = new Set<string>();
                        extractDependencies(m.team1Placeholder).forEach(d => deps.add(d));
                        extractDependencies(m.team2Placeholder).forEach(d => deps.add(d));
                        if(deps.size > 0) matchDependencyMap.set(m.id, Array.from(deps));
                    });
                };
                const bracketSet = catData.playoffs as PlayoffBracketSet;
                if (!bracketSet.upper && !bracketSet.lower) { // Single elimination
                    processBracket(bracketSet as PlayoffBracket);
                } else { // Double elimination
                    processBracket(bracketSet.upper);
                    processBracket(bracketSet.lower);
                    processBracket(bracketSet.playoffs);
                }
            }
        });

        // --- 2. Scheduling Loop ---
        const playerAvailability = new Map<string, Date>();
        const courtAvailability = new Map<string, Date>();
        sortedCourts.forEach(c => courtAvailability.set(c.name, new Date(0)));
        const dependencyFinishTimes = new Map<string, Date>();
        const groupFinishedMatchCounts = new Map<string, number>();

        let unscheduledMatches = new Set(allMatchesToSchedule.map(m => getMatchId(m)));
        let currentTime = parseTime(_globalSettings.startTime);
        
        while (unscheduledMatches.size > 0) {
            let scheduledSomethingInThisSlot = false;
            
            const availableCourts = sortedCourts.filter(court => {
                const courtAvailTime = courtAvailability.get(court.name)!;
                return !isAfter(courtAvailTime, currentTime) && court.slots.some(slot => 
                    !isBefore(currentTime, parseTime(slot.startTime)) && 
                    !isAfter(addMinutes(currentTime, matchDuration), parseTime(slot.endTime))
                );
            });

            if (availableCourts.length > 0) {
                let candidateMatches = allMatchesToSchedule.filter(m => unscheduledMatches.has(getMatchId(m)));

                let schedulableNow = candidateMatches.filter(match => {
                    if (isAfter(categoryStartTimeMap.get(match.category)!, currentTime)) return false;

                    const deps = matchDependencyMap.get(getMatchId(match));
                    if (deps) {
                        for (const dep of deps) {
                            const finishTime = dependencyFinishTimes.get(dep);
                            if (!finishTime || isAfter(finishTime, currentTime)) return false;
                        }
                    }
                    
                    const players = matchPlayerMap.get(getMatchId(match)) || [];
                    if ('team1Placeholder' in match && players.length === 0) return false; // Don't schedule playoff matches without players yet
                    
                    return players.every(p => !isAfter(playerAvailability.get(p) || new Date(0), currentTime));
                });
                
                schedulableNow.sort((a, b) => {
                    const getWorstRestTime = (match: SchedulableMatch) => {
                        const players = matchPlayerMap.get(getMatchId(match)) || [];
                        if (players.length === 0) return new Date(0).getTime();
                        const lastPlayedTimes = players.map(p => (playerAvailability.get(p) || new Date(0)).getTime());
                        return Math.min(...lastPlayedTimes);
                    };
                    return getWorstRestTime(b) - getWorstRestTime(a);
                });
                
                const playersScheduledInThisSlot = new Set<string>();

                for (const court of availableCourts) {
                    const matchToSchedule = schedulableNow.find(match => {
                        const players = matchPlayerMap.get(getMatchId(match)) || [];
                        return players.every(p => !playersScheduledInThisSlot.has(p));
                    });
                    
                    if (matchToSchedule) {
                        const matchId = getMatchId(matchToSchedule);
                        const matchEndTime = addMinutes(currentTime, matchDuration);
                        matchToSchedule.time = format(currentTime, 'HH:mm');
                        matchToSchedule.court = court.name;
                        
                        courtAvailability.set(court.name, matchEndTime);
                        
                        const players = matchPlayerMap.get(matchId) || [];
                        players.forEach(p => {
                            playerAvailability.set(p, matchEndTime);
                            playersScheduledInThisSlot.add(p);
                        });
                        
                        if ('id' in matchToSchedule && matchToSchedule.id) {
                           dependencyFinishTimes.set(matchToSchedule.id, matchEndTime);
                        }
                        
                        if ('groupName' in matchToSchedule && matchToSchedule.groupName) {
                           const groupKey = `${matchToSchedule.category}-${matchToSchedule.groupName}`;
                           const newCount = (groupFinishedMatchCounts.get(groupKey) || 0) + 1;
                           groupFinishedMatchCounts.set(groupKey, newCount);
                           if (newCount === groupMatchCounts.get(groupKey)) {
                               dependencyFinishTimes.set(`${matchToSchedule.groupName}-finished`, matchEndTime);
                           }
                        }

                        unscheduledMatches.delete(matchId);
                        schedulableNow = schedulableNow.filter(m => getMatchId(m) !== matchId);
                        scheduledSomethingInThisSlot = true;
                    }
                }
            }

            if (!scheduledSomethingInThisSlot) {
                const allNextAvailableTimes = [
                    ...Array.from(courtAvailability.values()),
                    ...Array.from(playerAvailability.values()),
                ].filter(d => isAfter(d, currentTime));

                if (allNextAvailableTimes.length > 0) {
                     currentTime = new Date(Math.min(...allNextAvailableTimes.map(d => d.getTime())));
                } else {
                    currentTime = addMinutes(currentTime, matchDuration);
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

const teamToKey = (team?: Team) => {
    if (!team || !team.player1 || !team.player2) return '';
    return `${team.player1}-${team.player2}`.trim().toLowerCase();
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
    
    const groupsData: { name: string; teams: Team[]; matches: { team1: Team; team2: Team }[] } = Array.from({ length: numberOfGroups }, (_, i) => ({
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



    