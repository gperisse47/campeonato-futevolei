import type {
  GenerateTournamentGroupsInput as AIGenerateTournamentGroupsInput,
  GenerateTournamentGroupsOutput as AIGenerateTournamentGroupsOutput,
} from "@/ai/flows/generate-tournament-groups"
import { z } from "zod"

export type GenerateTournamentGroupsOutput = AIGenerateTournamentGroupsOutput;
export type GenerateTournamentGroupsInput = AIGenerateTournamentGroupsInput;


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
      const teamsArray = data.teams.split(",").map((t) => t.trim()).filter(Boolean);
      return teamsArray.length === data.numberOfTeams;
    },
    {
      message: "O número de duplas na lista não corresponde ao número total de duplas informado.",
      path: ["teams"],
    }
  );

export type TournamentFormValues = z.infer<typeof formSchema>;
