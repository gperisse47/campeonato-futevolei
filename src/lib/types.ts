import type {
  GenerateTournamentGroupsInput as AIGenerateTournamentGroupsInput,
  GenerateTournamentGroupsOutput as AIGenerateTournamentGroupsOutput,
} from "@/ai/flows/generate-tournament-groups"
import { z } from "zod"

export type { GenerateTournamentGroupsOutput, GenerateTournamentGroupsInput };

export const teamSchema = z.object({
  player1: z.string(),
  player2: z.string(),
});
export type Team = z.infer<typeof teamSchema>;

export const formSchema = z
  .object({
    category: z.string().min(1, "A categoria é obrigatória."),
    numberOfTeams: z.coerce
      .number({ invalid_type_error: "Deve ser um número." })
      .int("Deve ser um número inteiro.")
      .positive("Deve ser um número positivo."),
    numberOfGroups: z.coerce
      .number({ invalid_type_error: "Deve ser um número." })
      .int("Deve ser um número inteiro.")
      .positive("Deve ser um número positivo."),
    teams: z.string().min(1, "A lista de duplas é obrigatória."),
    groupFormationStrategy: z.enum(["balanced", "random"], {
      required_error: "A estratégia de formação é obrigatória.",
    }),
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
      return teamsArray.every((team) => team.includes(" e ") && team.split(" e ").length === 2 && team.split(' e ')[0].trim() && team.split(' e ')[1].trim());
    },
    {
      message: "Cada dupla deve ter dois jogadores separados por ' e '. Ex: Jogador A e Jogador B.",
      path: ["teams"],
    }
  );

export type TournamentFormValues = z.infer<typeof formSchema>;

// Types for state management within the component
export type MatchWithScore = AIGenerateTournamentGroupsOutput['groups'][0]['matches'][0] & {
  score1?: number;
  score2?: number;
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
  losses: number;
  setsWon: number;
  setsLost: number;
  setDifference: number;
};

export type PlayoffMatch = {
  team1Placeholder: string;
  team2Placeholder: string;
};