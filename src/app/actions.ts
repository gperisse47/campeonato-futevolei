
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

const teamToKey = (team?: Team): string => {
    if (!team || !team.player1 || !team.player2) return '';
    const players = [team.player1.trim(), team.player2.trim()].sort();
    return `${players[0]} e ${players[1]}`;
};

type SchedulableMatch = (MatchWithScore | PlayoffMatch) & {
    category: string;
    id: string; // Ensure id is always present
    groupName?: string;
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

        // Data structures for scheduling
        const matchPlayerMap = new Map<string, string[]>();
        const matchDependencyMap = new Map<string, string[]>();
        const dependencyToMatchesMap = new Map<string, string[]>();
        const groupMatchCounts = new Map<string, { total: number, finished: number }>();
        const scheduledFinishTimes = new Map<string, Date>();
        
        const allMatches: SchedulableMatch[] = [];

        Object.entries(db).forEach(([categoryName, categoryData]) => {
            if (categoryName === '_globalSettings') return;
            const category = categoryData as CategoryData;
            
            const processMatch = (match: MatchWithScore | PlayoffMatch, groupName?: string) => {
                match.time = '';
                match.court = '';
                
                const schedulableMatch: SchedulableMatch = { ...match, category: categoryName, id: match.id!, groupName };
                allMatches.push(schedulableMatch);

                if (!match.id) return;

                matchPlayerMap.set(match.id, getPlayersFromMatch(schedulableMatch));

                const deps = new Set<string>();
                
                if (groupName) {
                    const groupKey = `${categoryName}-${groupName}`;
                    deps.add(`${groupKey}-finished`);
                    if(!groupMatchCounts.has(groupKey)) groupMatchCounts.set(groupKey, { total: 0, finished: 0 });
                    groupMatchCounts.get(groupKey)!.total++;
                }

                [match.team1Placeholder, match.team2Placeholder].forEach(p => {
                    extractDependencies(p, categoryName).forEach(depId => {
                       deps.add(depId);
                    });
                });
                
                if (deps.size > 0) {
                    const dependencies = Array.from(deps);
                    matchDependencyMap.set(match.id, dependencies);
                    dependencies.forEach(dep => {
                        if (!dependencyToMatchesMap.has(dep)) dependencyToMatchesMap.set(dep, []);
                        dependencyToMatchesMap.get(dep)!.push(match.id!);
                    });
                }
            };
            
            category.tournamentData?.groups.forEach(g => g.matches.forEach(m => processMatch(m, g.name)));
            if (category.playoffs) {
                const playoffs = category.playoffs as PlayoffBracketSet;
                 if (category.formValues.tournamentType === 'doubleElimination' && ('upper' in playoffs || 'lower' in playoffs || 'playoffs' in playoffs)) {
                    if (playoffs.upper) Object.values(playoffs.upper).flat().forEach(m => processMatch(m));
                    if (playoffs.lower) Object.values(playoffs.lower).flat().forEach(m => processMatch(m));
                    if (playoffs.playoffs) Object.values(playoffs.playoffs).flat().forEach(m => processMatch(m));
                } else {
                    Object.values(playoffs as PlayoffBracket).flat().forEach(m => processMatch(m));
                }
            }
        });

        let unscheduledMatches = new Set<string>(allMatches.map(m => m.id!));
        const courtAvailability = new Map<string, Date>(sortedCourts.map(c => [c.name, new Date(0)]));
        const playerAvailability = new Map<string, Date>();
        
        let lastProgressTime = -1;
        let currentTime = startOfDay(new Date()).getTime();

        while (unscheduledMatches.size > 0) {
            
            if (lastProgressTime === currentTime) {
                const nextCourtFreeTime = Math.min(...Array.from(courtAvailability.values()).map(d => d.getTime()).filter(t => t > currentTime));
                if (isFinite(nextCourtFreeTime)) {
                    currentTime = nextCourtFreeTime;
                } else {
                    currentTime += 1; // Should not happen often, but prevents infinite loops
                }
            }
            lastProgressTime = currentTime;


            const readyMatches = allMatches.filter(match => {
                if (!unscheduledMatches.has(match.id!)) return false;

                const dependencies = matchDependencyMap.get(match.id!);
                if (dependencies) {
                    const allDepsMet = dependencies.every(dep => scheduledFinishTimes.has(dep));
                    if (!allDepsMet) return false;
                }
                return true;
            });
            
            if (readyMatches.length === 0 && unscheduledMatches.size > 0) {
                // If no matches are ready, advance time. This shouldn't be the primary way to advance time.
                const nextRelevantTime = Math.min(
                    ...Array.from(courtAvailability.values()).map(d => d.getTime()),
                    ...Array.from(playerAvailability.values()).map(d => d.getTime())
                );
                if (isFinite(nextRelevantTime) && nextRelevantTime > currentTime) {
                    currentTime = nextRelevantTime;
                } else {
                    // This case indicates a potential logic error or cycle.
                    // For now, break to avoid infinite loop. A more robust solution might log an error.
                    console.error("Scheduling deadlock detected. Aborting.");
                    break;
                }
                continue;
            }


            readyMatches.sort((a, b) => {
                 const getRestTime = (match: SchedulableMatch) => {
                    const players = matchPlayerMap.get(match.id!) || getPlayersFromMatch(match);
                    const depFinishTime = Math.max(0, ...(matchDependencyMap.get(match.id!) || []).map(dep => (scheduledFinishTimes.get(dep) || new Date(0)).getTime()));
                    const playerReadyTime = Math.max(0, ...players.map(p => (playerAvailability.get(p) || new Date(0)).getTime()));
                    return Math.max(depFinishTime, playerReadyTime);
                };
                return getRestTime(a) - getRestTime(b);
            });
            

            for (const matchToSchedule of readyMatches) {
                 if (!unscheduledMatches.has(matchToSchedule.id!)) continue;

                const players = matchPlayerMap.get(matchToSchedule.id!) || getPlayersFromMatch(matchToSchedule);
                const categoryStartTime = parseTime((db[matchToSchedule.category] as CategoryData).formValues.startTime || _globalSettings.startTime);
                const depsFinishTime = new Date(Math.max(0, ...(matchDependencyMap.get(matchToSchedule.id!) || []).map(dep => (scheduledFinishTimes.get(dep) || new Date(0)).getTime())));
                const playerReadyTime = new Date(Math.max(0, ...players.map(p => (playerAvailability.get(p) || new Date(0)).getTime())));
                
                let scheduledTime: Date | null = null;
                let scheduledCourt: Court | null = null;

                let earliestStartTime = new Date(Math.max(categoryStartTime.getTime(), playerReadyTime.getTime(), depsFinishTime.getTime()));
            
                let foundSlot = false;
                // This loop finds the absolute earliest time this match can be played across all courts
                 for (const court of sortedCourts) {
                    const courtReadyTime = courtAvailability.get(court.name) || new Date(0);
                    let proposedStartTime = new Date(Math.max(earliestStartTime.getTime(), courtReadyTime.getTime()));

                    for (const slot of court.slots) {
                        const slotStart = parseTime(slot.startTime);
                        const slotEnd = parseTime(slot.endTime);

                        if(isAfter(proposedStartTime, slotEnd)) continue;
                        if(isBefore(proposedStartTime, slotStart)) proposedStartTime = slotStart;
                        
                        const proposedEndTime = addMinutes(proposedStartTime, matchDuration);

                        if (!isAfter(proposedEndTime, slotEnd)) {
                            if (!scheduledTime || isBefore(proposedStartTime, scheduledTime)) {
                                scheduledTime = proposedStartTime;
                                scheduledCourt = court;
                            }
                            // We don't break here, we check all courts to find the *earliest possible* time
                        }
                    }
                }

                if (scheduledTime && scheduledCourt) {
                    const endTime = addMinutes(scheduledTime, matchDuration);

                    // Find the match in the original DB object to update it
                    const originalMatch = findMatchInDb(db, matchToSchedule.category, matchToSchedule.id);
                    if (originalMatch) {
                       originalMatch.time = format(scheduledTime, 'HH:mm');
                       originalMatch.court = scheduledCourt.name;
                    }

                    courtAvailability.set(scheduledCourt.name, endTime);
                    players.forEach(p => playerAvailability.set(p, endTime));
                    scheduledFinishTimes.set(matchToSchedule.id!, endTime);
                    unscheduledMatches.delete(matchToSchedule.id!);

                    if (matchToSchedule.groupName) {
                        const groupKey = `${matchToSchedule.category}-${matchToSchedule.groupName}`;
                        const groupProgress = groupMatchCounts.get(groupKey)!;
                        groupProgress.finished++;
                        if (groupProgress.finished === groupProgress.total) {
                            const groupFinishedKey = `${groupKey}-finished`;
                            scheduledFinishTimes.set(groupFinishedKey, endTime);
                        }
                    }
                }
            }
        }
        
        await writeDb(db);
        return { success: true };
    } catch (e: any) {
        console.error("Erro no agendamento:", e, e.stack);
        return { success: false, error: e.message || "Erro inesperado durante o agendamento." };
    }
}


function findMatchInDb(db: TournamentsState, categoryName: string, matchId: string): MatchWithScore | PlayoffMatch | undefined {
    const categoryData = db[categoryName] as CategoryData;
    if (!categoryData) return undefined;

    if (categoryData.tournamentData?.groups) {
        for (const group of categoryData.tournamentData.groups) {
            const match = group.matches.find(m => m.id === matchId);
            if (match) return match;
        }
    }

    if (categoryData.playoffs) {
        const findInBracket = (bracket: PlayoffBracket | undefined): PlayoffMatch | undefined => {
            if (!bracket) return undefined;
            for (const round of Object.values(bracket)) {
                const match = round.find(m => m.id === matchId);
                if (match) return match;
            }
            return undefined;
        };
        const bracketSet = categoryData.playoffs as PlayoffBracketSet;
        if (bracketSet.upper || bracketSet.lower || bracketSet.playoffs) {
            return findInBracket(bracketSet.upper) || findInBracket(bracketSet.lower) || findInBracket(bracketSet.playoffs);
        } else {
            return findInBracket(bracketSet as PlayoffBracket);
        }
    }
    return undefined;
}


function getPlayersFromMatch(match: SchedulableMatch): string[] {
    const players: string[] = [];
    if (match.team1?.player1) players.push(match.team1.player1);
    if (match.team1?.player2) players.push(match.team1.player2);
    if (match.team2?.player1) players.push(match.team2.player1);
    if (match.team2?.player2) players.push(match.team2.player2);
    return players;
}

function extractDependencies(placeholder: string | undefined, categoryName: string): string[] {
    if (!placeholder) return [];
    
    // For "Vencedor Quartas de Final-1"
    const matchDepMatch = placeholder.match(/(?:Vencedor|Perdedor)\s(.+)/);
    if (matchDepMatch && matchDepMatch[1]) {
        // Assume the ID from placeholder is complete
        return [matchDepMatch[1].trim()];
    }
    
    // For "1º do Grupo A"
    const groupDepMatch = placeholder.match(/\d+º\sdo\s(.+)/);
    if (groupDepMatch && groupDepMatch[1]) {
        return [`${categoryName}-${groupDepMatch[1].trim()}-finished`];
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

export async function resetAllSchedules(): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();

        for (const categoryName in db) {
            if (categoryName === '_globalSettings') continue;
            
            const categoryData = db[categoryName] as CategoryData;

            // Reset group matches
            if (categoryData.tournamentData?.groups) {
                categoryData.tournamentData.groups.forEach(group => {
                    group.matches.forEach(match => {
                        match.time = '';
                        match.court = '';
                    });
                });
            }

            // Reset playoff matches
            if (categoryData.playoffs) {
                const resetBracket = (bracket: PlayoffBracket | undefined) => {
                    if (!bracket) return;
                    Object.values(bracket).forEach(round => {
                        round.forEach(match => {
                            match.time = '';
                            match.court = '';
                        });
                    });
                };
                
                const bracketSet = categoryData.playoffs as PlayoffBracketSet;
                if(bracketSet.upper || bracketSet.lower || bracketSet.playoffs) {
                    resetBracket(bracketSet.upper);
                    resetBracket(bracketSet.lower);
                    resetBracket(bracketSet.playoffs);
                } else {
                    resetBracket(bracketSet as PlayoffBracket);
                }
            }
        }

        await writeDb(db);
        return { success: true };
    } catch (e: any) {
        console.error("Erro ao resetar os horários:", e);
        return { success: false, error: e.message || "Erro desconhecido ao resetar os horários." };
    }
}
