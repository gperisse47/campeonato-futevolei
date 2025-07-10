
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
import { format, addMinutes, parse, isBefore, isEqual, startOfDay } from 'date-fns';


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

const baseDate = startOfDay(new Date());

const parseTime = (timeStr: string): Date => {
    if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) {
        console.error("Invalid time string for parsing:", timeStr);
        // Return a very early date to not interfere with valid times
        return new Date(baseDate.getTime());
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

        // 1. Gather all matches and associate them with their original objects for updating
        const allMatches: { original: MatchWithScore | PlayoffMatch; categoryName: string }[] = [];
        const categoryNames = Object.keys(db).filter(k => k !== '_globalSettings');
        
        categoryNames.forEach(catName => {
            const catData = db[catName] as CategoryData;
            // Reset schedules before gathering
            const resetMatch = (match: MatchWithScore | PlayoffMatch) => {
                match.time = '';
                match.court = '';
                return match;
            };

            if (catData.tournamentData?.groups) {
                catData.tournamentData.groups.forEach(group => {
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
                processBracket(bracketSet.upper);
                processBracket(bracketSet.lower);
                processBracket(bracketSet.playoffs);
            }
        });

        // Helper to get players from a match
        const getPlayers = (team1?: Team, team2?: Team): string[] => {
            const players: string[] = [];
            if (team1?.player1) players.push(team1.player1);
            if (team1?.player2) players.push(team1.player2);
            if (team2?.player1) players.push(team2.player1);
            if (team2?.player2) players.push(team2.player2);
            return players.filter(Boolean);
        };
        
        // 2. Scheduling loop
        let currentTime = parseTime(_globalSettings.startTime);
        const playerAvailability: { [playerName: string]: Date } = {};
        const restDuration = matchDuration; 

        let unscheduledMatches = allMatches.filter(m => !m.original.time);

        while (unscheduledMatches.length > 0) {
            const availableCourts = _globalSettings.courts.filter(court => {
                for (const slot of court.slots) {
                    const slotStart = parseTime(slot.startTime);
                    const slotEnd = parseTime(slot.endTime);
                    const matchEndTime = addMinutes(currentTime, matchDuration);
                    if (!isBefore(currentTime, slotStart) && !isBefore(slotEnd, matchEndTime)) {
                        return true;
                    }
                }
                return false;
            });
            
            const scheduledMatchesInThisSlot: (MatchWithScore | PlayoffMatch)[] = [];
            const scheduledPlayerNamesThisSlot: string[] = [];
            
            // Find all possible matches for this time slot across all available courts
            const candidateMatches = unscheduledMatches.filter(matchWrapper => {
                const { original: match, categoryName } = matchWrapper;
                const players = getPlayers(match.team1, match.team2);
                
                // A match must have players to be scheduled
                if ((!match.team1 && !match.team1Placeholder) || (!match.team2 && !match.team2Placeholder) || players.length === 0) {
                    return false;
                }
                
                const categoryStartTimeStr = (db[categoryName] as CategoryData).formValues.startTime || _globalSettings.startTime;
                const categoryStartTime = parseTime(categoryStartTimeStr);
                
                // Respect category start time
                if (isBefore(currentTime, categoryStartTime)) {
                    return false;
                }

                // Check player availability (rest time)
                const playersAreRested = players.every(p => {
                    const availableTime = playerAvailability[p] || startOfDay(new Date(0));
                    return !isBefore(currentTime, availableTime);
                });
                if (!playersAreRested) {
                    return false;
                }

                return true;
            });
            
            // Now, assign the best candidates to the available courts
            for (const court of availableCourts) {
                const matchToSchedule = candidateMatches.find(matchWrapper => {
                     const players = getPlayers(matchWrapper.original.team1, matchWrapper.original.team2);
                     // Check if any player is already scheduled in this exact time slot
                     return players.every(p => !scheduledPlayerNamesThisSlot.includes(p));
                });

                if (matchToSchedule) {
                    const timeStr = format(currentTime, 'HH:mm');
                    matchToSchedule.original.time = timeStr;
                    matchToSchedule.original.court = court.name;
                    
                    const playersInMatch = getPlayers(matchToSchedule.original.team1, matchToSchedule.original.team2);
                    scheduledPlayerNamesThisSlot.push(...playersInMatch);
                    
                    // Update player availability for the next round
                    const matchEndTime = addMinutes(currentTime, matchDuration);
                    const restEndTime = addMinutes(matchEndTime, restDuration);
                    playersInMatch.forEach(p => {
                        playerAvailability[p] = restEndTime;
                    });
                    
                    // Remove from candidates for this time slot
                    const indexInCandidates = candidateMatches.findIndex(m => m.original === matchToSchedule.original);
                    if (indexInCandidates > -1) {
                         candidateMatches.splice(indexInCandidates, 1);
                    }
                }
            }
            
            unscheduledMatches = allMatches.filter(m => !m.original.time);

            // Advance time
            let nextEarliestTime: Date | null = null;
            // Find the next available court slot start time
            _globalSettings.courts.forEach(court => {
                court.slots.forEach(slot => {
                    const slotStart = parseTime(slot.startTime);
                    if (isBefore(currentTime, slotStart) && (!nextEarliestTime || isBefore(slotStart, nextEarliestTime))) {
                        nextEarliestTime = slotStart;
                    }
                });
            });

            // If no future slots, break
            if (!nextEarliestTime && unscheduledMatches.length > 0) {
                 const nextPlayerAvailableTime = Math.min(...Object.values(playerAvailability).map(d => d.getTime()));
                 if(nextPlayerAvailableTime && nextPlayerAvailableTime > currentTime.getTime()) {
                     currentTime = new Date(nextPlayerAvailableTime);
                 } else {
                     currentTime = addMinutes(currentTime, matchDuration);
                 }
            } else if (nextEarliestTime) {
                const potentialNextTime = addMinutes(currentTime, matchDuration);
                if (isBefore(potentialNextTime, nextEarliestTime)) {
                     currentTime = potentialNextTime;
                } else {
                    currentTime = nextEarliestTime;
                }
            } else {
                 currentTime = addMinutes(currentTime, matchDuration);
            }

            if (isBefore(parseTime("23:59"), currentTime)) {
                console.warn("Scheduler reached end of day, breaking loop.");
                break;
            }
        }
        
        if (unscheduledMatches.length > 0) {
             console.warn(`${unscheduledMatches.length} matches could not be scheduled.`);
             unscheduledMatches.forEach(m => console.log(m));
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
        const teamIndex = teamsList.findIndex(t => t.trim().replace(/\s+/g, ' ') === originalTeamKey.replace(/\s+/g, ' '));
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
          if (teamIsEqual(match.team1, originalTeam)) match.team1 = { ...updatedTeam };
          if (teamIsEqual(match.team2, originalTeam)) match.team2 = { ...updatedTeam };
        });

        // Update group.standings
        group.standings.forEach(standing => {
          if (teamIsEqual(standing.team, originalTeam)) standing.team = { ...updatedTeam };
        });
      });
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
        updatePlayoffBracket(bracketSet.upper);
        updatePlayoffBracket(bracketSet.lower);
        updatePlayoffBracket(bracketSet.playoffs);
    }

    await writeDb(db);
    return { success: true };

  } catch (e: any) {
    console.error("Error updating team:", e);
    return { success: false, error: e.message || "Ocorreu um erro desconhecido ao atualizar a dupla." };
  }
}
