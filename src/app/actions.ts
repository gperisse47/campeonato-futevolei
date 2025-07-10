

"use server"
import 'dotenv/config';

import fs from "fs/promises"
import path from "path"
import {
  generateTournamentGroups,
  type GenerateTournamentGroupsOutput
} from "@/ai/flows/generate-tournament-groups"
import type { TournamentsState, CategoryData, GlobalSettings, Team, PlayoffBracket, PlayoffBracketSet, GenerateTournamentGroupsInput, PlayoffMatch, MatchWithScore, Court } from "@/lib/types"
import { z } from 'zod';
import { format, addMinutes, parse, max, isBefore } from 'date-fns';


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
        courts: [{ name: "Quadra 1", slots: [{startTime: "09:00", endTime: "18:00"}] }]
      };
    }
    return data;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const defaultData = {
        _globalSettings: {
            startTime: "08:00",
            estimatedMatchDuration: 20,
            courts: [{ name: "Quadra 1", slots: [{startTime: "09:00", endTime: "18:00"}] }]
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

const baseDate = new Date();
const parseTime = (timeStr: string) => {
    if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) {
      console.error("Invalid time string for parsing:", timeStr);
      // Return a very early date to not interfere with valid times
      return new Date('1970-01-01T00:00:00.000Z');
    }
    const [h, m] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(h, m, 0, 0);
    return date;
};


export async function rescheduleAllTournaments(): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();
        const { _globalSettings } = db;
        const categoryNames = Object.keys(db).filter(k => k !== '_globalSettings');

        // Reset all schedules
        categoryNames.forEach(catName => {
            const catData = db[catName] as CategoryData;
            catData.tournamentData?.groups.forEach(group => {
                group.matches.forEach(match => {
                    match.time = '';
                    match.court = '';
                });
            });

            const processBracket = (bracket: PlayoffBracket | undefined) => {
                if (!bracket) return;
                Object.values(bracket).flat().forEach(match => {
                    match.time = '';
                    match.court = '';
                });
            };

             if (catData.playoffs) {
                if ('upper' in catData.playoffs || 'lower' in catData.playoffs || 'playoffs' in catData.playoffs) {
                    const bracketSet = catData.playoffs as PlayoffBracketSet;
                    processBracket(bracketSet.upper);
                    processBracket(bracketSet.lower);
                    processBracket(bracketSet.playoffs);
                } else {
                    processBracket(catData.playoffs as PlayoffBracket);
                }
            }
        });
        
        type MatchReference = (MatchWithScore | PlayoffMatch) & { categoryName: string };
        
        // Collect all matches again after reset
        let allMatches: MatchReference[] = [];
        categoryNames.forEach(catName => {
            const catData = db[catName] as CategoryData;
            const groupMatches = catData.tournamentData?.groups.flatMap(group =>
                group.matches.map(match => ({ ...match, categoryName: catName, isPlayoff: false, roundOrder: -1 }))
            ) || [];

            let playoffMatches: MatchReference[] = [];
            const collectPlayoffMatches = (bracket: PlayoffBracket | undefined) => {
                if (!bracket) return;
                Object.values(bracket).flat().forEach(match => {
                    playoffMatches.push({ ...match, categoryName: catName, isPlayoff: true });
                });
            }

            if (catData.playoffs) {
                if ('upper' in catData.playoffs || 'lower' in catData.playoffs || 'playoffs' in catData.playoffs) {
                    const bracketSet = catData.playoffs as PlayoffBracketSet;
                    collectPlayoffMatches(bracketSet.upper);
                    collectPlayoffMatches(bracketSet.lower);
                    collectPlayoffMatches(bracketSet.playoffs);
                } else {
                    collectPlayoffMatches(catData.playoffs as PlayoffBracket);
                }
            }
            allMatches = allMatches.concat(groupMatches, playoffMatches);
        });

        // Initialize availability trackers
        const courtAvailability: { [courtName: string]: Date } = {};
        _globalSettings.courts.forEach(c => courtAvailability[c.name] = parseTime(_globalSettings.startTime));
        
        const playerAvailability: { [playerName: string]: Date } = {};
        const playerLastCourt: { [playerName: string]: string } = {};

        const unscheduledMatches = new Set<MatchReference>(allMatches);

        let currentTime = parseTime(_globalSettings.startTime);
        let scheduledInPass = true;
        
        // Category rotation
        const categoriesByStartTime = categoryNames
            .map(name => ({ name, startTime: parseTime((db[name] as CategoryData).formValues.startTime || _globalSettings.startTime) }))
            .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
            
        let lastScheduledCategoryIndex = -1;

        while (unscheduledMatches.size > 0 && scheduledInPass) {
            scheduledInPass = false;

            const nextCourtTimes = Object.values(courtAvailability);
            if(nextCourtTimes.length > 0) {
                 currentTime = new Date(Math.min(...nextCourtTimes.map(t => t.getTime())));
            }

            // Find next available slot for any court
            let potentialNextTime = new Date(8640000000000000); // Max date
            let foundSlot = false;

            for (const court of _globalSettings.courts) {
                for (const slot of court.slots) {
                    const slotStart = parseTime(slot.startTime);
                    const effectiveStartTime = max([slotStart, courtAvailability[court.name]]);
                    
                    if (isBefore(effectiveStartTime, parseTime(slot.endTime))) {
                         if (isBefore(effectiveStartTime, potentialNextTime)) {
                            potentialNextTime = effectiveStartTime;
                            foundSlot = true;
                        }
                    }
                }
            }

            if(foundSlot) {
                currentTime = potentialNextTime;
            } else {
                break; // No available slots left
            }

            // Category Rotation Logic
            let categoriesToTry = categoriesByStartTime.map(c => c.name);
            if (lastScheduledCategoryIndex !== -1) {
                const reordered = [
                    ...categoriesToTry.slice(lastScheduledCategoryIndex + 1),
                    ...categoriesToTry.slice(0, lastScheduledCategoryIndex + 1)
                ];
                categoriesToTry = reordered;
            }

            for (const court of _globalSettings.courts) {
                if (courtAvailability[court.name].getTime() > currentTime.getTime()) {
                    continue;
                }
                 // Check if current time is within any slot for this court
                let isInSlot = false;
                for (const slot of court.slots) {
                     const slotEnd = addMinutes(parseTime(slot.endTime), -_globalSettings.estimatedMatchDuration);
                     if (currentTime >= parseTime(slot.startTime) && currentTime <= slotEnd) {
                        isInSlot = true;
                        break;
                    }
                }
                 if (!isInSlot) {
                    continue;
                }

                let scheduledMatchOnCourt = false;
                for (let i = 0; i < categoriesToTry.length; i++) {
                    const categoryName = categoriesToTry[i];
                    
                    // Filter for matches in the current category that can be scheduled
                    const candidateMatches = Array.from(unscheduledMatches).filter(match => {
                         if (match.categoryName !== categoryName) return false;
                         if (!match.team1 || !match.team2) return false;
                         
                         const categoryStartTime = parseTime((db[categoryName] as CategoryData).formValues.startTime || _globalSettings.startTime);
                         if (currentTime.getTime() < categoryStartTime.getTime()) return false;
                         
                         const players = [match.team1.player1, match.team1.player2, match.team2.player1, match.team2.player2].filter(Boolean) as string[];
                         const playersReady = players.every(p => currentTime.getTime() >= (playerAvailability[p]?.getTime() || 0));

                         return playersReady;
                    });

                    // Sort candidate matches: playoffs first
                    candidateMatches.sort((a, b) => b.roundOrder - a.roundOrder);


                    for (const match of candidateMatches) {
                        // Found a match to schedule
                        const timeStr = format(currentTime, 'HH:mm');
                        const matchEndTime = addMinutes(currentTime, _globalSettings.estimatedMatchDuration);

                        // Find the original match object and update it
                         let originalMatch: (MatchWithScore | PlayoffMatch | undefined);
                         const categoryData = db[match.categoryName] as CategoryData;
                         
                         if(match.roundOrder === -1){ // Group match
                            const group = categoryData.tournamentData?.groups.find(g => g.matches.some(m => !m.time && teamIsEqual(m.team1, match.team1) && teamIsEqual(m.team2, match.team2)));
                            originalMatch = group?.matches.find(m => !m.time && teamIsEqual(m.team1, match.team1) && teamIsEqual(m.team2, match.team2));
                         } else { // Playoff match
                            const findInBracket = (bracket: PlayoffBracket | undefined) => {
                                if (!bracket) return undefined;
                                return Object.values(bracket).flat().find(m => m.id === match.id && !m.time);
                            }
                            if ('upper' in categoryData.playoffs! || 'lower' in categoryData.playoffs! || 'playoffs' in categoryData.playoffs!) {
                                const bracketSet = categoryData.playoffs as PlayoffBracketSet;
                                originalMatch = findInBracket(bracketSet.upper) || findInBracket(bracketSet.lower) || findInBracket(bracketSet.playoffs);
                            } else {
                                originalMatch = findInBracket(categoryData.playoffs as PlayoffBracket);
                            }
                         }
                        
                         if (originalMatch) {
                            originalMatch.time = timeStr;
                            originalMatch.court = court.name;
    
                            // Update availability
                            courtAvailability[court.name] = matchEndTime;
                            const players = [match.team1.player1, match.team1.player2, match.team2.player1, match.team2.player2].filter(Boolean) as string[];
                            players.forEach(p => {
                                playerAvailability[p] = matchEndTime;
                                playerLastCourt[p] = court.name;
                            });
    
                            unscheduledMatches.delete(match);
                            scheduledInPass = true;
                            scheduledMatchOnCourt = true;
                            lastScheduledCategoryIndex = categoriesByStartTime.findIndex(c => c.name === categoryName);
                            break; // Move to the next court
                         }
                    }
                    if (scheduledMatchOnCourt) break; // Break from category loop
                }
            }
        }
        
        if (unscheduledMatches.size > 0) {
            console.warn(`${unscheduledMatches.size} matches could not be scheduled.`);
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
    return (teamA.player1 === teamB.player1 && teamA.player2 === teamB.player2) || (teamA.player1 === teamB.player2 && teamA.player2 === teamB.player1);
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

    return GenerateTournamentGroupsOutputSchema.parse({ groups });
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
        const teamIndex = teamsList.findIndex(t => t.trim() === originalTeamKey);
        if (teamIndex !== -1) {
            teamsList[teamIndex] = updatedTeamKey;
            categoryData.formValues.teams = teamsList.join('\n');
        }
    }

    // Update teams in tournamentData (groups)
    if (categoryData.tournamentData?.groups) {
      categoryData.tournamentData.groups.forEach(group => {
        // Update group.teams array
        group.teams = group.teams.map(updateTeamObject);

        // Update group.matches
        group.matches.forEach(match => {
          if (match.team1) match.team1 = updateTeamObject(match.team1);
          if (match.team2) match.team2 = updateTeamObject(match.team2);
        });

        // Update group.standings
        group.standings.forEach(standing => {
          standing.team = updateTeamObject(standing.team);
        });
      });
    }

    // Update teams in playoffs
    if (categoryData.playoffs) {
        const updatePlayoffBracket = (bracket: PlayoffBracket | undefined) => {
            if (!bracket) return;
            Object.values(bracket).forEach(round => {
                round.forEach(match => {
                    if (match.team1) match.team1 = updateTeamObject(match.team1);
                    if (match.team2) match.team2 = updateTeamObject(match.team2);
                });
            });
        };
        
        if ('upper' in categoryData.playoffs || 'lower' in categoryData.playoffs || 'playoffs' in categoryData.playoffs) {
            const bracketSet = categoryData.playoffs as PlayoffBracketSet;
            updatePlayoffBracket(bracketSet.upper);
            updatePlayoffBracket(bracketSet.lower);
            updatePlayoffBracket(bracketSet.playoffs);
        } else {
            updatePlayoffBracket(categoryData.playoffs as PlayoffBracket);
        }
    }

    await writeDb(db);
    return { success: true };

  } catch (e: any) {
    console.error("Error updating team:", e);
    return { success: false, error: e.message || "Ocorreu um erro desconhecido ao atualizar a dupla." };
  }
}
