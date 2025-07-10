"use server"

import {
  generateTournamentGroups,
  type GenerateTournamentGroupsInput,
  type GenerateTournamentGroupsOutput,
} from "@/ai/flows/generate-tournament-groups"

export async function generateGroupsAction(
  input: GenerateTournamentGroupsInput
): Promise<{
  success: boolean
  data?: GenerateTournamentGroupsOutput
  error?: string
}> {
  try {
    const output = await generateTournamentGroups(input)
    if (!output.groups || output.groups.length === 0) {
      return { success: false, error: "A IA não conseguiu gerar os grupos. Tente novamente." }
    }
    return { success: true, data: output }
  } catch (e: any) {
    console.error(e)
    return { success: false, error: e.message || "Ocorreu um erro desconhecido." }
  }
}
