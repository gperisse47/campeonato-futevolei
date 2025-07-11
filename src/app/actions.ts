
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
        const allMatches: { original: MatchWithScore | PlayoffMatch; categoryName: string }[] = [];
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
                    group.matches.forEach(match => {
                        resetMatch(match);
                        allMatches.push({ original: match, categoryName: catName });
                    });
                });
            }
            if (catData.playoffs) {
                const processBracket = (bracket: PlayoffBracket | undefined) => {
                    if (!bracket) return;
                    Object.values(bracket).flat().forEach(match => {
                         resetMatch(match);
                         allMatches.push({ original: match, categoryName: catName });
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
        
        const sortedCourts = [..._globalSettings.courts].sort((a, b) => (a.priority || 99) - (b.priority || 99));

        const playerAvailability: { [playerName: string]: Date } = {};
        const courtAvailability: { [courtName: string]: Date } = {};
        sortedCourts.forEach(c => courtAvailability[c.name] = parseTime(_globalSettings.startTime));

        const restDuration = 0; // No extra rest time

        let unscheduledMatches = allMatches.filter(m => !m.original.time);
        let loopGuard = 0;

        while (unscheduledMatches.length > 0) {
            loopGuard++;
            if (loopGuard > 20000) { 
                console.error("Scheduler stuck in a loop. Aborting.");
                break;
            }

            let scheduledSomethingInCycle = false;

            for (const court of sortedCourts) {
                const earliestCourtTime = courtAvailability[court.name];
                
                // Find all schedulable matches for this court at the earliest possible time
                const schedulableMatches = unscheduledMatches
                    .map((matchWrapper, index) => ({ matchWrapper, index })) // Keep track of original index
                    .filter(({ matchWrapper }) => {
                        const { original: match, categoryName } = matchWrapper;
                        const players = getPlayers(match.team1, match.team2);
                        if (players.length === 0) return false;

                        const playersReadyTime = new Date(Math.max(...players.map(p => (playerAvailability[p] || new Date(0)).getTime())));
                        const categoryStartTime = parseTime((db[categoryName] as CategoryData).formValues.startTime || _globalSettings.startTime);
                        
                        const scheduleTime = new Date(Math.max(earliestCourtTime.getTime(), playersReadyTime.getTime(), categoryStartTime.getTime()));
                        const matchEndTime = addMinutes(scheduleTime, matchDuration);
                        
                        const isCourtAvailableInSlot = court.slots.some(slot => {
                            const slotStart = parseTime(slot.startTime);
                            const slotEnd = parseTime(slot.endTime);
                            return !isBefore(scheduleTime, slotStart) && !isBefore(slotEnd, matchEndTime);
                        });
                        return isCourtAvailableInSlot;
                    });
                
                if (schedulableMatches.length > 0) {
                    // Iterate through the schedulable matches and schedule the first one that is valid
                    for (const { matchWrapper, index: originalIndex } of schedulableMatches) {
                         const players = getPlayers(matchWrapper.original.team1, matchWrapper.original.team2);
                         const playersReadyTime = new Date(Math.max(...players.map(p => (playerAvailability[p] || new Date(0)).getTime())));
                         const categoryStartTime = parseTime((db[matchWrapper.categoryName] as CategoryData).formValues.startTime || _globalSettings.startTime);

                         const scheduleTime = new Date(Math.max(earliestCourtTime.getTime(), playersReadyTime.getTime(), categoryStartTime.getTime()));

                         // Re-check player availability at the actual scheduleTime, as another match might have been scheduled in this cycle for other players
                         const allPlayersAvailable = players.every(p => (playerAvailability[p] || new Date(0)) <= scheduleTime);

                         if (allPlayersAvailable) {
                            // Find the correct index in the current `unscheduledMatches` array
                            const currentIndexOfMatch = unscheduledMatches.findIndex(m => m.original === matchWrapper.original);
                            if (currentIndexOfMatch === -1) continue; // Match was already scheduled in this cycle

                            const [scheduledMatchWrapper] = unscheduledMatches.splice(currentIndexOfMatch, 1);
                            
                            scheduledMatchWrapper.original.time = format(scheduleTime, 'HH:mm');
                            scheduledMatchWrapper.original.court = court.name;
                            scheduledSomethingInCycle = true;
                            
                            const restEndTime = addMinutes(scheduleTime, matchDuration + restDuration);
                            players.forEach(p => { playerAvailability[p] = restEndTime; });
                            courtAvailability[court.name] = addMinutes(scheduleTime, matchDuration);
                            
                            // Break from the inner loop since we've scheduled a match for this court
                            break; 
                         }
                    }
                }
            }
             
            if (!scheduledSomethingInCycle && unscheduledMatches.length > 0) {
                // If nothing was scheduled, advance the time of the earliest available court
                const nextCourtAvailableTime = new Date(Math.min(...Object.values(courtAvailability).map(t => t.getTime())));
                const courtToAdvance = Object.keys(courtAvailability).reduce((a, b) => courtAvailability[a] < courtAvailability[b] ? a : b);
                courtAvailability[courtToAdvance] = addMinutes(nextCourtAvailableTime, 1);
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


      

    