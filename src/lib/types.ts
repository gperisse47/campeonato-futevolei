
import type {
  GenerateTournamentGroupsInput as AIGenerateTournamentGroupsInput,
  GenerateTournamentGroupsOutput as AIGenerateTournamentGroupsOutput,
} from "@/ai/flows/generate-tournament-groups"
import { z } from "zod"

export type { GenerateTournamentGroupsOutput };

// We only need a subset of the AI input type for the action
export type GenerateTournamentGroupsInput = Pick<
  AIGenerateTournamentGroupsInput,
  | "numberOfTeams"
  | "numberOfGroups"
  | "groupFormationStrategy"
  | "teams"
  | "category"
  | "tournamentType"
>;

export const teamSchema = z.object({
  player1: z.string(),
  player2: z.string(),
});
export type Team = z.infer<typeof teamSchema>;

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
    groupFormationStrategy: z.enum(["balanced", "random"], {
      required_error: "A estratégia de formação é obrigatória.",
    }),
    includeThirdPlace: z.boolean().default(true),
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
      if (data.numberOfTeams <= 0 || data.numberOfGroups <= 0) return true; // Avoid division by zero if other validations fail
      const teamsInSmallestGroup = Math.floor(data.numberOfTeams / data.numberOfGroups);
      return teamsInSmallestGroup > 0 && data.teamsPerGroupToAdvance < teamsInSmallestGroup;
    },
    {
        message: "O número de classificados deve ser menor que o número de duplas em qualquer grupo.",
        path: ["teamsPerGroupToAdvance"],
    }
  )
   .refine(
    (data) => {
        if (data.tournamentType === 'groups') return true;
        const numTeams = data.numberOfTeams;
        return numTeams > 1 && (numTeams & (numTeams - 1)) === 0;
    },
    {
        message: "Para este tipo de torneio, o número de duplas deve ser uma potência de 2 (4, 8, 16...).",
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

// Types for state management within the component
export type MatchWithScore = AIGenerateTournamentGroupsOutput['groups'][0]['matches'][0] & {
  score1?: number;
  score2?: number;
  time?: string;
};

export type GroupWithScores = Omit<AIGenerateTournamentGroupsOutput['groups'][0], 'matches'> & {
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
  roundOrder: number; // Used for sorting rounds
};

export type PlayoffBracket = {
  [round: string]: PlayoffMatch[];
};

export type PlayoffBracketSet = {
    upper?: PlayoffBracket;
    lower?: PlayoffBracket;
    grandFinal?: PlayoffBracket;
    [key: string]: PlayoffBracket | undefined;
} | PlayoffBracket;


export type CategoryData = {
  tournamentData: TournamentData | null;
  playoffs: PlayoffBracketSet | null;
  formValues: TournamentFormValues;
}

export type TournamentsState = {
  [categoryName: string]: CategoryData;
}

export type ConsolidatedMatch = {
    category: string;
    stage: string;
    team1: string;
    team2: string;
    score1?: number;
    score2?: number;
    time?: string;
};

