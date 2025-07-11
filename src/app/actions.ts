
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
        const tournamentStartTime = parseTime(_globalSettings.startTime);
        const sortedCourts = [..._globalSettings.courts].sort((a, b) => (a.priority || 99) - (b.priority || 99));

        const courtAvailability = new Map<string, Date>();
        const playerAvailability = new Map<string, Date>();
        const dependencyFinishTimes = new Map<string, Date>();
        const categoryStartTimeMap = new Map<string, Date>();
        const matchPlayerMap = new Map<string, string[]>();
        const matchDependencyMap = new Map<string, string[]>();
        const groupMatchCounts = new Map<string, number>();
        const groupFinishedMatchCounts = new Map<string, number>();
        
        let allMatches: SchedulableMatch[] = [];

        sortedCourts.forEach(court => {
             const earliestSlotStart = court.slots.reduce((earliest, slot) => {
                const slotStart = parseTime(slot.startTime);
                return isBefore(slotStart, earliest) ? slotStart : earliest;
            }, new Date(8640000000000000)); // Max date
            courtAvailability.set(court.name, isBefore(tournamentStartTime, earliestSlotStart) ? earliestSlotStart : tournamentStartTime);
        });

        Object.entries(db).forEach(([category, catData]) => {
            if (category === '_globalSettings') return;
            const categoryTyped = catData as CategoryData;
            
            const startTime = parseTime(categoryTyped.formValues.startTime || _globalSettings.startTime);
            categoryStartTimeMap.set(category, startTime);

            const clearSchedule = (m: any) => ({ ...m, time: '', court: '' });

            if (categoryTyped.tournamentData?.groups) {
                categoryTyped.tournamentData.groups.forEach(group => {
                    const groupKey = `${category}-${group.name}`;
                    const matchesInGroup = group.matches || [];
                    groupMatchCounts.set(groupKey, matchesInGroup.length);
                    groupFinishedMatchCounts.set(groupKey, 0);

                    matchesInGroup.forEach(match => {
                        const schedulableMatch = { ...clearSchedule(match), category, groupName: group.name };
                        const id = getMatchId(schedulableMatch);
                        allMatches.push(schedulableMatch);
                        matchPlayerMap.set(id, getPlayersFromMatch(schedulableMatch));
                        (getPlayersFromMatch(schedulableMatch)).forEach(p => {
                            if (!playerAvailability.has(p)) playerAvailability.set(p, tournamentStartTime);
                        });
                    });
                });
            }

            const processBracket = (bracket: PlayoffBracket | undefined) => {
                if (!bracket) return;
                Object.values(bracket).flat().forEach(match => {
                    if (!match.id) return;
                    const schedulableMatch = { ...clearSchedule(match), category };
                    const id = getMatchId(schedulableMatch);
                    allMatches.push(schedulableMatch);
                    matchPlayerMap.set(id, getPlayersFromMatch(schedulableMatch));
                    
                    const deps = new Set([
                        ...extractDependencies(match.team1Placeholder),
                        ...extractDependencies(match.team2Placeholder),
                    ]);
                    if (deps.size > 0) matchDependencyMap.set(id, Array.from(deps));
                });
            };

            const playoffs = categoryTyped.playoffs as PlayoffBracketSet;
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
        
        let unscheduledMatches = new Set(allMatches.map(m => getMatchId(m)));
        
        while (unscheduledMatches.size > 0) {
            
            let earliestNextAvailableTime = new Date(8640000000000000); // Far future date

            const schedulableNow: { match: SchedulableMatch, court: Court, availableAt: Date }[] = [];

            // Find all possible matches for all available courts at their earliest available time
            for (const court of sortedCourts) {
                const courtAvailableAt = courtAvailability.get(court.name)!;

                const findNextSlotTime = (time: Date): Date | null => {
                    const sortedSlots = court.slots.sort((a,b) => a.startTime.localeCompare(b.startTime));
                    for(const slot of sortedSlots) {
                        const slotStart = parseTime(slot.startTime);
                        const slotEnd = parseTime(slot.endTime);
                        if (!isAfter(addMinutes(time, matchDuration), slotEnd)) {
                           if(isBefore(time, slotStart)) return slotStart;
                           return time;
                        }
                    }
                    return null;
                }
                
                let checkTime = findNextSlotTime(courtAvailableAt);
                if (!checkTime) {
                    earliestNextAvailableTime = isBefore(courtAvailableAt, earliestNextAvailableTime) ? courtAvailableAt : earliestNextAvailableTime;
                    continue;
                };

                const readyMatchesForCourt = allMatches.filter(m => {
                    const id = getMatchId(m);
                    if (!unscheduledMatches.has(id)) return false;

                    if (isBefore(checkTime!, categoryStartTimeMap.get(m.category)!)) return false;

                    const players = matchPlayerMap.get(id) || [];
                    const playersAvailableAt = players.reduce((latest, p) => {
                        const pAvail = playerAvailability.get(p)!;
                        return isAfter(pAvail, latest) ? pAvail : latest;
                    }, new Date(0));

                    if (isAfter(playersAvailableAt, checkTime!)) {
                        earliestNextAvailableTime = isBefore(playersAvailableAt, earliestNextAvailableTime) ? playersAvailableAt : earliestNextAvailableTime;
                        return false;
                    }

                    const deps = matchDependencyMap.get(id) || [];
                    const depsAvailableAt = deps.reduce((latest, d) => {
                        const dAvail = dependencyFinishTimes.get(d) || new Date(8640000000000000);
                        return isAfter(dAvail, latest) ? dAvail : latest;
                    }, new Date(0));

                    if (isAfter(depsAvailableAt, checkTime!)) {
                        earliestNextAvailableTime = isBefore(depsAvailableAt, earliestNextAvailableTime) ? depsAvailableAt : earliestNextAvailableTime;
                        return false;
                    }
                    return true;
                });


                if(readyMatchesForCourt.length > 0) {
                   readyMatchesForCourt.sort((a, b) => {
                        const playersA = matchPlayerMap.get(getMatchId(a)) || [];
                        const lastPlayerTimeA = Math.min(...playersA.map(p => (playerAvailability.get(p) || tournamentStartTime).getTime()));
                        
                        const playersB = matchPlayerMap.get(getMatchId(b)) || [];
                        const lastPlayerTimeB = Math.min(...playersB.map(p => (playerAvailability.get(p) || tournamentStartTime).getTime()));

                        if (lastPlayerTimeA !== lastPlayerTimeB) {
                            return lastPlayerTimeA - lastPlayerTimeB;
                        }
                        
                        const startTimeA = categoryStartTimeMap.get(a.category)!.getTime();
                        const startTimeB = categoryStartTimeMap.get(b.category)!.getTime();
                        return startTimeA - startTimeB;
                    });

                    schedulableNow.push({ match: readyMatchesForCourt[0], court, availableAt: checkTime! });
                } else {
                     earliestNextAvailableTime = isBefore(courtAvailableAt, earliestNextAvailableTime) ? courtAvailableAt : earliestNextAvailableTime;
                }
            }


            if (schedulableNow.length > 0) {
                 schedulableNow.sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime());
                
                const scheduledPlayersThisSlot = new Set<string>();
                const scheduledMatchesThisSlot = new Set<string>();

                for(const { match, court, availableAt } of schedulableNow) {
                    const id = getMatchId(match);
                    if(scheduledMatchesThisSlot.has(id)) continue;

                    const players = matchPlayerMap.get(id)!;
                    if(players.some(p => scheduledPlayersThisSlot.has(p))) continue;
                    
                    const endTime = addMinutes(availableAt, matchDuration);
                    
                    match.time = format(availableAt, 'HH:mm');
                    match.court = court.name;

                    players.forEach(p => {
                        playerAvailability.set(p, endTime);
                        scheduledPlayersThisSlot.add(p);
                    });

                    courtAvailability.set(court.name, endTime);
                    
                    if (match.groupName) {
                        const groupKey = `${match.category}-${match.groupName}`;
                        const finishedCount = (groupFinishedMatchCounts.get(groupKey) || 0) + 1;
                        groupFinishedMatchCounts.set(groupKey, finishedCount);
                        if (finishedCount >= (groupMatchCounts.get(groupKey) || Infinity)) {
                             dependencyFinishTimes.set(`${groupKey}-finished`, endTime);
                             dependencyFinishTimes.set(`${match.groupName}-finished`, endTime);
                        }
                    }
                    if ('id' in match && match.id) {
                        dependencyFinishTimes.set(match.id, endTime);
                    }
                    
                    unscheduledMatches.delete(id);
                    scheduledMatchesThisSlot.add(id);
                }

            } else {
                // No matches could be scheduled, advance time
                 if (isAfter(earliestNextAvailableTime, new Date(8000000000000000))) {
                    // No more possible matches or times, break loop to prevent infinite execution
                    break;
                }

                // Instead of jumping, we advance court times to the earliest next available slot
                // This prevents getting stuck
                for (const court of sortedCourts) {
                   const courtAvail = courtAvailability.get(court.name)!;
                   if (isBefore(courtAvail, earliestNextAvailableTime)) {
                       courtAvailability.set(court.name, earliestNextAvailableTime);
                   }
                }
            }
        }
        
        await writeDb(db);
        return { success: true };
    } catch (e: any) {
        console.error("Erro no agendamento:", e.stack);
        return { success: false, error: e.message || "Erro inesperado." };
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



    

