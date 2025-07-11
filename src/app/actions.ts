
"use server"
import 'dotenv/config';

import fs from "fs/promises"
import path from "path"
import {
  generateTournamentGroups,
  type GenerateTournamentGroupsOutput
} from "@/ai/flows/generate-tournament-groups"
import type { TournamentsState, CategoryData, GlobalSettings, Team, PlayoffBracket, PlayoffBracketSet, GenerateTournamentGroupsInput, PlayoffMatch, MatchWithScore, Court, TournamentFormValues } from "@/lib/types"
import { z } from 'zod';
import { format, addMinutes, parse, isBefore, isEqual, startOfDay } from 'date-fns';
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
        console.warn("Invalid or empty time string for parsing, defaulting to start of day:", timeStr);
        return new Date(baseDate);
    }
    const [h, m] = timeStr.split(':').map(Number);
    const date = new Date(baseDate);
    date.setHours(h, m, 0, 0);
    return date;
};


export async function rescheduleAllTournaments(): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();
        const { _globalSettings } = db;
        if (!_globalSettings?.courts || _globalSettings.courts.length === 0) {
            return { success: false, error: "Nenhuma quadra configurada nas configurações globais." };
        }

        const matchDuration = _globalSettings.estimatedMatchDuration;
        const sortedCourts = [..._globalSettings.courts].sort((a, b) => (a.priority || 99) - (b.priority || 99));

        let unscheduledMatches: { original: MatchWithScore | PlayoffMatch; categoryName: string }[] = [];
        const categoryNames = Object.keys(db).filter(k => k !== '_globalSettings');
        
        categoryNames.forEach(catName => {
            const catData = db[catName] as CategoryData;
            const resetMatch = (match: MatchWithScore | PlayoffMatch) => {
                match.time = '';
                match.court = '';
                return match;
            };

            if (catData.tournamentData?.groups) {
                const groups = Array.isArray(catData.tournamentData.groups) ? catData.tournamentData.groups : Object.values(catData.tournamentData.groups);
                groups.forEach(group => {
                    if (group.matches) {
                        group.matches.forEach(match => {
                            resetMatch(match);
                            unscheduledMatches.push({ original: match, categoryName: catName });
                        });
                    }
                });
            }
            if (catData.playoffs) {
                const processBracket = (bracket: PlayoffBracket | undefined) => {
                    if (!bracket) return;
                    Object.values(bracket).flat().forEach(match => {
                         resetMatch(match);
                         unscheduledMatches.push({ original: match, categoryName: catName });
                    });
                };
                const bracketSet = catData.playoffs as PlayoffBracketSet;
                if(bracketSet.upper || bracketSet.lower || bracketSet.playoffs) {
                    processBracket(bracketSet.upper);
                    processBracket(bracketSet.lower);
                    processBracket(bracketSet.playoffs);
                } else {
                    processBracket(bracketSet as PlayoffBracket)
                }
            }
        });

        const getPlayers = (team1?: Team, team2?: Team): string[] => {
            const players: string[] = [];
            if (team1?.player1) players.push(team1.player1);
            if (team1?.player2) players.push(team1.player2);
            if (team2?.player1) players.push(team2.player1);
            if (team2?.player2) players.push(team2.player2);
            return players.filter(Boolean);
        };

        const playerLastPlayed: { [playerName: string]: Date } = {};
        
        let currentTime = parseTime(_globalSettings.startTime);

        while (unscheduledMatches.length > 0) {
            let scheduledSomethingInThisTimeSlot = false;
            const playersScheduledInThisSlot: Set<string> = new Set();

            for (const court of sortedCourts) {
                // Check if court is available for this time slot
                const isCourtAvailableInSlot = court.slots.some(slot => {
                    const slotStart = parseTime(slot.startTime);
                    const slotEnd = parseTime(slot.endTime);
                    const matchEndTime = addMinutes(currentTime, matchDuration);
                    return !isBefore(currentTime, slotStart) && !isBefore(matchEndTime, slotEnd);
                });

                if (!isCourtAvailableInSlot) continue;

                // Find possible matches for this court and time
                const possibleMatches = unscheduledMatches.filter(matchWrapper => {
                    const players = getPlayers(matchWrapper.original.team1, matchWrapper.original.team2);
                    if (players.length === 0) return false;
                    if (players.some(p => playersScheduledInThisSlot.has(p))) return false;

                    const categoryStartTime = parseTime((db[matchWrapper.categoryName] as CategoryData).formValues.startTime || _globalSettings.startTime);
                    if (isBefore(currentTime, categoryStartTime)) return false;

                    const matchEndTimeWithRest = addMinutes(currentTime, matchDuration);
                    return players.every(p => {
                        const lastPlayedEnd = playerLastPlayed[p];
                        return !lastPlayedEnd || !isBefore(currentTime, lastPlayedEnd);
                    });
                });

                if (possibleMatches.length > 0) {
                    // Sort possible matches: prioritize the match where the player with the LEAST rest has rested the MOST.
                    possibleMatches.sort((a, b) => {
                        const playersA = getPlayers(a.original.team1, a.original.team2);
                        const playersB = getPlayers(b.original.team1, b.original.team2);
                        
                        // For each match, find the time the player who played most recently finished.
                        const lastPlayedTimeA = Math.max(...playersA.map(p => (playerLastPlayed[p] || new Date(0)).getTime()));
                        const lastPlayedTimeB = Math.max(...playersB.map(p => (playerLastPlayed[p] || new Date(0)).getTime()));
                        
                        // We want to schedule the match whose "bottleneck" player has rested longer.
                        // A smaller lastPlayedTime means more rest. So, sort ascending by time.
                        return lastPlayedTimeA - lastPlayedTimeB;
                    });
                    
                    const matchToSchedule = possibleMatches[0];
                    const players = getPlayers(matchToSchedule.original.team1, matchToSchedule.original.team2);
                    
                    matchToSchedule.original.time = format(currentTime, 'HH:mm');
                    matchToSchedule.original.court = court.name;
                    scheduledSomethingInThisTimeSlot = true;

                    const matchEndTime = addMinutes(currentTime, matchDuration);
                    players.forEach(p => {
                        playerLastPlayed[p] = matchEndTime;
                        playersScheduledInThisSlot.add(p);
                    });

                    unscheduledMatches = unscheduledMatches.filter(m => m !== matchToSchedule);
                }
            }

            if (scheduledSomethingInThisTimeSlot) {
                // If we scheduled something, we stay in the same time slot to try and fill other courts.
                // The loop will continue, but players scheduled in this slot are now unavailable.
            } else {
                // If nothing was scheduled in this time slot for any court, advance time
                currentTime = addMinutes(currentTime, matchDuration);
            }
        }
        
        if (unscheduledMatches.length > 0) {
             console.warn(`${unscheduledMatches.length} matches could not be scheduled.`);
             unscheduledMatches.forEach(m => console.log(m.original.team1, m.original.team2, m.categoryName));
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
    
    const groups: { name: string; teams: Team[]; matches: { team1: Team; team2: Team }[] }[] = Array.from({ length: numberOfGroups }, (_, i) => ({
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
        groups[groupIndex].teams.push(team);
    });

    // Generate round-robin matches for each group
    groups.forEach(group => {
        for (let i = 0; i < group.teams.length; i++) {
            for (let j = i + 1; j < group.teams.length; j++) {
                group.matches.push({
                    team1: group.teams[i],
                    team2: group.teams[j]
                });
            }
        }
    });

    return GenerateTournamentGroupsOutputSchema.parse({ groups, playoffMatches: [] });
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
    // This case should be less likely now with dotenv
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
                newCategoryData.tournamentData = { groups: await initializeStandings(result.data.groups) };
                newCategoryData.playoffs = await initializePlayoffs(values, result.data);
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


      

    

    
