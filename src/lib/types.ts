

import type {
  GenerateTournamentGroupsInput as AIGenerateTournamentGroupsInput,
} from "@/ai/flows/generate-tournament-groups"
import { z } from "zod"

// This is now an algorithmic output, not from AI.
export type GenerateTournamentGroupsOutput = z.infer<typeof AlgorithmicGenerateTournamentGroupsOutputSchema>;

// We only need a subset of the AI input type for the action
export type GenerateTournamentGroupsInput = AIGenerateTournamentGroupsInput;

export const teamSchema = z.object({
  player1: z.string(),
  player2: z.string(),
});
export type Team = z.infer<typeof teamSchema>;

export const timeSlotSchema = z.object({
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Formato de hora inválido (HH:MM)."),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Formato de hora inválido (HH:MM)."),
}).refine(data => data.startTime < data.endTime, {
    message: "O horário final deve ser após o horário inicial.",
    path: ["endTime"],
});
export type TimeSlot = z.infer<typeof timeSlotSchema>;

export const courtSchema = z.object({
    name: z.string().min(1, "O nome da quadra é obrigatório."),
    slots: z.array(timeSlotSchema).min(1, "Deve haver pelo menos um horário disponível para a quadra."),
});
export type Court = z.infer<typeof courtSchema>;

export const globalSettingsSchema = z.object({
  estimatedMatchDuration: z.coerce
      .number({ invalid_type_error: "Deve ser um número." })
      .int("Deve ser um número inteiro.")
      .positive("A duração deve ser positiva."),
  courts: z.array(courtSchema).min(1, "Deve haver pelo menos uma quadra."),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Formato de hora inválido (HH:MM)."),
});
export type GlobalSettings = z.infer<typeof globalSettingsSchema>;

export const formSchema = z
  .object({
    category: z.string().min(1, "A categoria é obrigatória."),
    tournamentType: z.enum(['groups', 'singleElimination', 'doubleElimination']),
    numberOfTeams: z.coerce
      .number({ invalid_type_error: "Deve ser um número." })
      .int("Deve ser um número inteiro.")
      .positive("Deve ser um número positivo."),
    numberOfGroups: z.coerce
      .number({ invalid_type_error: "Deve ser um número." })
      .int("Deve ser um número inteiro.")
      .positive("Deve ser um número positivo.").optional(),
    teamsPerGroupToAdvance: z.coerce
      .number({ invalid_type_error: "Deve ser um número." })
      .int("Deve ser um número inteiro.")
      .min(1, "Deve classificar pelo menos uma dupla.").optional(),
    teams: z.string().min(1, "A lista de duplas é obrigatória."),
    groupFormationStrategy: z.enum(["order", "random"], {
      required_error: "A estratégia de formação é obrigatória.",
    }),
    includeThirdPlace: z.boolean().default(true),
    updatedAt: z.string().optional(),
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Formato de hora inválido (HH:MM).").optional().or(z.literal('')),
  })
  .refine(
    (data) => {
      const teamsArray = data.teams
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
      return teamsArray.length === data.numberOfTeams;
    },
    {
      message: "O número de duplas na lista não corresponde ao número total de duplas informado.",
      path: ["teams"],
    }
  )
   .refine(
    (data) => {
        const teamsArray = data.teams
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean);
        return teamsArray.every((team) => /.+\s+e\s+.+/i.test(team));
    },
    {
        message: "Cada dupla deve ter dois jogadores separados por ' e '. Ex: Jogador A e Jogador B.",
        path: ["teams"],
    }
   )
  .refine(
    (data) => {
      if (data.tournamentType !== 'groups') return true;
      if (!data.numberOfGroups || !data.teamsPerGroupToAdvance) return false;
      const qualifiers = data.numberOfGroups * data.teamsPerGroupToAdvance;
      // Check if qualifiers is a power of 2 (and > 1)
      return qualifiers > 1 && (qualifiers & (qualifiers - 1)) === 0;
    },
    {
      message: "O número total de classificados (Grupos x Classificados) deve ser uma potência de 2 (2, 4, 8, 16...).",
      path: ["teamsPerGroupToAdvance"],
    }
  )
  .refine(
    (data) => {
        if (data.tournamentType !== 'groups') return true;
        if (!data.numberOfGroups || !data.teamsPerGroupToAdvance) return false;
        
        const numTeams = data.numberOfTeams;
        const numGroups = data.numberOfGroups;
        if (numTeams <= 0 || numGroups <= 0) return true; // Avoid division by zero, let other validators handle it.

        const minTeamsPerGroup = Math.floor(numTeams / numGroups);

        // This check ensures that you can't advance more teams than there are in the smallest possible group.
        return data.teamsPerGroupToAdvance < minTeamsPerGroup;
    },
    {
        message: "O número de classificados deve ser menor que o número de duplas no menor grupo.",
        path: ["teamsPerGroupToAdvance"],
    }
)
  .refine(
    (data) => {
        if (data.tournamentType !== 'singleElimination') return true;
        const numTeams = data.numberOfTeams;
        return numTeams > 1 && (numTeams & (numTeams - 1)) === 0;
    },
    {
        message: "Para mata-mata simples, o número de duplas deve ser uma potência de 2 (4, 8, 16...).",
        path: ["numberOfTeams"],
    }
   )
   .refine(
    (data) => {
      if (data.tournamentType !== 'doubleElimination') return true;
      if (data.numberOfTeams < 2) return false;
      return true;
    },
    {
      message: "Dupla eliminação requer no mínimo 2 duplas.",
      path: ["numberOfTeams"],
    }
  )
  .refine(
    (data) => {
      const players = data.teams
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean)
        .flatMap((teamString) => teamString.split(/\s+e\s+/i).map((p) => p.trim()));

      const uniquePlayers = new Set(players);
      return players.length === uniquePlayers.size;
    },
    {
      message: "Existem jogadores duplicados na lista. Cada pessoa só pode fazer parte de uma dupla.",
      path: ["teams"],
    }
  );

export type TournamentFormValues = z.infer<typeof formSchema>;

// Zod schema for the output of the algorithmic group generation.
export const AlgorithmicGenerateTournamentGroupsOutputSchema = z.object({
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

// This is the AI output type, redefined here since we can't import it
type AIOutputGroup = {
    name: string;
    teams: Team[];
    matches: {
        team1: Team;
        team2: Team;
    }[];
};

// Types for state management within the component
export type MatchWithScore = AIOutputGroup['matches'][0] & {
  score1?: number;
  score2?: number;
  time?: string;
  court?: string;
};

export type GroupWithScores = Omit<AIOutputGroup, 'matches'> & {
  matches: MatchWithScore[];
  standings: TeamStanding[];
};

export type TournamentData = {
  groups: GroupWithScores[];
};

export type TeamStanding = {
  team: Team;
  played: number;
  wins: number;
  setsWon: number;
  setDifference: number;
};

export type PlayoffMatch = {
  id: string;
  name: string;
  team1Placeholder: string;
  team2Placeholder: string;
  team1?: Team;
  team2?: Team;
  score1?: number;
  score2?: number;
  time?: string;
  court?: string;
  roundOrder: number; // Used for sorting rounds
};

export type PlayoffBracket = {
  [round: string]: PlayoffMatch[];
};

export type PlayoffBracketSet = {
    upper?: PlayoffBracket;
    lower?: PlayoffBracket;
    playoffs?: PlayoffBracket;
    [key: string]: PlayoffBracket | undefined;
} | PlayoffBracket;


export type CategoryData = {
  tournamentData: TournamentData | null;
  playoffs: PlayoffBracketSet | null;
  formValues: TournamentFormValues;
  totalMatches?: number;
}

export type TournamentsState = {
  _globalSettings: GlobalSettings;
  [categoryName: string]: CategoryData | GlobalSettings;
}

export type ConsolidatedMatch = {
    category: string;
    stage: string;
    team1: string;
    team2: string;
    score1?: number;
    score2?: number;
    time?: string;
    court?: string;
};
