

"use server"
import 'dotenv/config';

import fs from "fs/promises"
import path from "path"
import {
  generateTournamentGroups,
  type GenerateTournamentGroupsOutput
} from "@/ai/flows/generate-tournament-groups"
import type { TournamentsState, CategoryData, GlobalSettings, Team, PlayoffBracket, PlayoffBracketSet, GenerateTournamentGroupsInput, PlayoffMatch, MatchWithScore } from "@/lib/types"
import { z } from 'zod';
import { format, addMinutes, parse, max } from 'date-fns';


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

const baseDate = new Date();
const parseTime = (timeStr: string) => {
    if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) {
      console.error("Invalid time string for parsing:", timeStr);
      return baseDate;
    }
    const [h, m] = timeStr.split(':').map(Number);
    return parse(`${h}:${m}`, 'HH:mm', baseDate);
};


export async function rescheduleAllTournaments(): Promise<{ success: boolean; error?: string }> {
    try {
        const db = await readDb();
        const { _globalSettings } = db;
        const categories = Object.keys(db).filter(k => k !== '_globalSettings');

        type MatchReference = (MatchWithScore | PlayoffMatch) & { 
            categoryName: string; 
            categoryPriority: number 
        };

        const allMatches: MatchReference[] = [];

        categories.forEach(catName => {
            const catData = db[catName] as CategoryData;
            const categoryPriority = catData.formValues.priority || 99;

            // Group matches
            catData.tournamentData?.groups.forEach(group => {
                group.matches.forEach(match => {
                    match.time = '';
                    match.court = '';
                    allMatches.push({ ...match, categoryName: catName, categoryPriority, roundOrder: -1 });
                });
            });

            // Playoff matches
            const processBracket = (bracket: PlayoffBracket | undefined) => {
                if (!bracket) return;
                Object.values(bracket).flat().forEach(match => {
                    match.time = '';
                    match.court = '';
                    allMatches.push({ ...match, categoryName: catName, categoryPriority });
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
        
        allMatches.sort((a, b) => {
            if (a.categoryPriority !== b.categoryPriority) {
                return a.categoryPriority - b.categoryPriority;
            }
            return (b.roundOrder ?? -1) - (a.roundOrder ?? -1);
        });

        const courtAvailability = _globalSettings.courts
            .sort((a, b) => (a.priority || 99) - (b.priority || 99))
            .map(court => ({
                name: court.name,
                priority: court.priority || 99,
                slots: court.slots.map(slot => ({
                    start: parseTime(slot.startTime),
                    end: parseTime(slot.endTime)
                })).sort((a, b) => a.start.getTime() - b.start.getTime()),
                nextAvailableTime: parseTime(_globalSettings.startTime)
            }));
            
        const playerAvailability: { [playerName: string]: Date } = {};
        const allPlayers = new Set<string>();
        allMatches.forEach(match => {
            if (match.team1?.player1) allPlayers.add(match.team1.player1);
            if (match.team1?.player2) allPlayers.add(match.team1.player2);
            if (match.team2?.player1) allPlayers.add(match.team2.player1);
            if (match.team2?.player2) allPlayers.add(match.team2.player2);
        });
        allPlayers.forEach(p => playerAvailability[p] = parseTime(_globalSettings.startTime));
        
        allMatches.forEach(matchRef => {
            if (!matchRef.team1 || !matchRef.team2) {
                return; // Can't schedule matches without teams
            }
            
            let bestTime: Date | null = null;
            let bestCourtIndex = -1;

            const categoryStartTime = (db[matchRef.categoryName] as CategoryData)?.formValues?.startTime;
            const effectiveStartTime = parseTime(categoryStartTime || _globalSettings.startTime);

            const playersInMatch = [matchRef.team1.player1, matchRef.team1.player2, matchRef.team2.player1, matchRef.team2.player2].filter(Boolean);
            const playersNextAvailableTimes = playersInMatch.map(p => playerAvailability[p] || effectiveStartTime);
            
            let earliestPossibleStart = max([effectiveStartTime, ...playersNextAvailableTimes]);

            let foundSlot = false;
            let potentialStartTime = earliestPossibleStart;

            while (!foundSlot) {
                for (let i = 0; i < courtAvailability.length; i++) {
                     const court = courtAvailability[i];

                     const courtStartTime = max([potentialStartTime, court.nextAvailableTime]);
                     const courtEndTime = addMinutes(courtStartTime, _globalSettings.estimatedMatchDuration);

                     let isInSlot = false;
                     for (const slot of court.slots) {
                         if (courtStartTime >= slot.start && courtEndTime <= slot.end) {
                             isInSlot = true;
                             break;
                         }
                     }
                     if (isInSlot) {
                        bestTime = courtStartTime;
                        bestCourtIndex = i;
                        foundSlot = true;
                        break; 
                     }
                 }
                 if (!foundSlot) {
                    // if no slot found, advance time by 1 minute and retry
                    potentialStartTime = addMinutes(potentialStartTime, 1);
                 }
            }
            
            
            if (bestCourtIndex !== -1 && bestTime) {
                const assignedCourt = courtAvailability[bestCourtIndex];
                const timeStr = format(bestTime, 'HH:mm');
                const courtName = assignedCourt.name;

                // Find the original match object in the db and update it
                const categoryData = db[matchRef.categoryName] as CategoryData;
                let originalMatch: MatchWithScore | PlayoffMatch | undefined;

                if (matchRef.roundOrder === -1) { // Group match
                   originalMatch = categoryData.tournamentData?.groups
                    .flatMap(g => g.matches)
                    .find(m => m.team1.player1 === matchRef.team1.player1 && m.team1.player2 === matchRef.team1.player2 && m.team2.player1 === matchRef.team2.player1 && m.team2.player2 === matchRef.team2.player2);
                } else { // Playoff match
                    const findInBracket = (bracket: PlayoffBracket | undefined) => {
                        if (!bracket) return undefined;
                        return Object.values(bracket).flat().find(m => m.id === matchRef.id);
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
                    originalMatch.court = courtName;
                }
                
                const matchEndTime = addMinutes(bestTime, _globalSettings.estimatedMatchDuration);
                assignedCourt.nextAvailableTime = matchEndTime;
                playersInMatch.forEach(p => playerAvailability[p] = matchEndTime);
            }
        });

        await writeDb(db);
        return { success: true };
    } catch (e: any) {
        console.error("Error rescheduling all tournaments:", e);
        return { success: false, error: e.message || "Ocorreu um erro desconhecido ao reagendar." };
    }
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
