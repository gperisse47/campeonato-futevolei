
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
import { format, addMinutes, parse, max, isBefore, isEqual } from 'date-fns';


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

const baseDate = new Date('1970-01-01T00:00:00');
const parseTime = (timeStr: string) => {
    if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) {
      console.error("Invalid time string for parsing:", timeStr);
      // Return a very early date to not interfere with valid times
      return new Date('1970-01-01T00:00:00.000Z');
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

        const categoryNames = Object.keys(db).filter(k => k !== '_globalSettings');
        const matchDuration = _globalSettings.estimatedMatchDuration;

        // 1. Reset all schedules
        categoryNames.forEach(catName => {
            const catData = db[catName] as CategoryData;
             const resetMatchTime = (match: MatchWithScore | PlayoffMatch) => {
                match.time = '';
                match.court = '';
            };
            catData.tournamentData?.groups.forEach(group => group.matches.forEach(resetMatchTime));
            
            if (catData.playoffs) {
                const processBracket = (bracket: PlayoffBracket | undefined) => {
                    if (!bracket) return;
                    Object.values(bracket).flat().forEach(resetMatchTime);
                };
                const bracketSet = catData.playoffs as PlayoffBracketSet;
                processBracket(bracketSet.upper);
                processBracket(bracketSet.lower);
                processBracket(bracketSet.playoffs);
            }
        });
        
        // Helper to get all players from a match
        const getPlayers = (team1?: Team, team2?: Team): string[] => {
            const players: string[] = [];
            if (team1?.player1) players.push(team1.player1);
            if (team1?.player2) players.push(team1.player2);
            if (team2?.player1) players.push(team2.player1);
            if (team2?.player2) players.push(team2.player2);
            return players;
        };

        // 2. Gather all matches
        let unscheduledMatches: (MatchWithScore | PlayoffMatch)[] = [];
        categoryNames.forEach(catName => {
            const catData = db[catName] as CategoryData;
            const groupMatches = catData.tournamentData?.groups.flatMap(g => g.matches) || [];
            
            let playoffMatches: PlayoffMatch[] = [];
            if (catData.playoffs) {
                 const collectPlayoffMatches = (bracket: PlayoffBracket | undefined) => {
                    if (!bracket) return;
                    Object.values(bracket).flat().forEach(match => playoffMatches.push(match));
                }
                const bracketSet = catData.playoffs as PlayoffBracketSet;
                collectPlayoffMatches(bracketSet.upper);
                collectPlayoffMatches(bracketSet.lower);
                collectPlayoffMatches(bracketSet.playoffs);
            }
            unscheduledMatches.push(...groupMatches, ...playoffMatches);
        });

        // 3. Scheduling loop
        let currentTime = parseTime(_globalSettings.startTime);
        const playerAvailability: { [playerName: string]: Date } = {};
        const restDuration = matchDuration; // Player must rest for one match duration

        let matchesScheduledInLoop;
        do {
            matchesScheduledInLoop = 0;
            const scheduledMatchesThisTime: (MatchWithScore | PlayoffMatch)[] = [];
            const occupiedCourtsThisTime: string[] = [];


            for (const court of _globalSettings.courts) {
                 if (occupiedCourtsThisTime.includes(court.name)) {
                    continue; // Skip if court is already booked for this time slot
                }
                
                let isCourtInSlot = false;
                for (const slot of court.slots) {
                    const slotStart = parseTime(slot.startTime);
                    const slotEnd = parseTime(slot.endTime);
                     if (isBefore(addMinutes(currentTime, matchDuration), addMinutes(slotEnd, 1)) && !isBefore(currentTime, slotStart)) {
                         isCourtInSlot = true;
                         break;
                    }
                }
                if (!isCourtInSlot) continue;

                const candidateMatch = unscheduledMatches.find(match => {
                    if (match.time) return false; // Already scheduled

                    const players = getPlayers(match.team1, match.team2);
                    if (players.length < 4 && !(match.team1Placeholder && match.team2Placeholder)) {
                         return false; // Not ready to be scheduled
                    }

                    // Find category start time
                    let categoryStartTimeStr = "00:00";
                    for(const catName of categoryNames){
                        const catData = db[catName] as CategoryData;
                        const findMatchInCategory = (m: MatchWithScore | PlayoffMatch) => {
                             if ('id' in m && 'id' in match && m.id === match.id) return true;
                             if (teamIsEqual(m.team1, match.team1) && teamIsEqual(m.team2, match.team2)) return true;
                             return false;
                        }

                        if(catData.tournamentData?.groups.some(g => g.matches.some(findMatchInCategory)) ||
                           (catData.playoffs && Object.values(catData.playoffs as PlayoffBracket).flat().some(findMatchInCategory))) {
                            categoryStartTimeStr = catData.formValues.startTime || _globalSettings.startTime;
                            break;
                        }
                    }

                    const categoryStartTime = parseTime(categoryStartTimeStr);
                    if (isBefore(currentTime, categoryStartTime)) {
                        return false;
                    }
                    
                    const playersAreAvailable = players.every(p => {
                         const availableTime = playerAvailability[p] || new Date(0);
                         return !isBefore(currentTime, availableTime);
                    });
                    
                    if (!playersAreAvailable) return false;

                    const playersAreNotInAnotherMatchThisTime = players.every(p => 
                        !scheduledMatchesThisTime.some(scheduled => getPlayers(scheduled.team1, scheduled.team2).includes(p))
                    );

                    return playersAreNotInAnotherMatchThisTime;
                });

                if (candidateMatch) {
                    const timeStr = format(currentTime, 'HH:mm');
                    candidateMatch.time = timeStr;
                    candidateMatch.court = court.name;
                    
                    const matchEndTime = addMinutes(currentTime, matchDuration);
                    const playerRestEndTime = addMinutes(matchEndTime, restDuration);
                    
                    const players = getPlayers(candidateMatch.team1, candidateMatch.team2);
                    players.forEach(p => {
                        playerAvailability[p] = playerRestEndTime;
                    });
                    
                    scheduledMatchesThisTime.push(candidateMatch);
                    occupiedCourtsThisTime.push(court.name);
                    matchesScheduledInLoop++;
                }
            }

            if (matchesScheduledInLoop === 0) {
                 currentTime = addMinutes(currentTime, matchDuration);
            }
            // Safety break to prevent infinite loops
             if (isBefore(parseTime("23:59"), currentTime)) {
                break;
            }

        } while (unscheduledMatches.some(m => !m.time));
        
        if (unscheduledMatches.some(m => !m.time)) {
             console.warn(`${unscheduledMatches.filter(m=>!m.time).length} matches could not be scheduled.`);
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
    
    const groups: { name: string; teams: Team[]; matches: { team1: Team; team2: Team }[] } = Array.from({ length: numberOfGroups }, (_, i) => ({
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

    