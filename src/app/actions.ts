

"use server"
require('dotenv').config()

import fs from "fs/promises"
import path from "path"
import {
  generateTournamentGroups,
  type GenerateTournamentGroupsOutput,
  type GenerateTournamentGroupsInput
} from "@/ai/flows/generate-tournament-groups"
import type { TournamentsState, CategoryData, GlobalSettings, Team, PlayoffBracket, PlayoffBracketSet } from "@/lib/types"

const dbPath = path.resolve(process.cwd(), "db.json")

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


export async function generateGroupsAction(
  input: GenerateTournamentGroupsInput
): Promise<{
  success: boolean
  data?: GenerateTournamentGroupsOutput
  error?: string
}> {
  try {
    const output = await generateTournamentGroups(input);

    if (input.tournamentType === 'groups') {
      if (!output.groups || output.groups.length === 0) {
        return { success: false, error: "A IA não conseguiu gerar os grupos. Tente novamente." };
      }
    } else if (input.tournamentType === 'singleElimination') {
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
