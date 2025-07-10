'use server';

/**
 * @fileOverview This file defines a Genkit flow for generating tournament groups using AI.
 *
 * - generateTournamentGroups - A function that generates tournament groups based on input parameters.
 * - GenerateTournamentGroupsInput - The input type for the generateTournamentGroups function.
 * - GenerateTournamentGroupsOutput - The return type for the generateTournamentGroups function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const TeamSchema = z.object({
  player1: z.string().describe('The name of the first player in the team.'),
  player2: z.string().describe('The name of the second player in the team.'),
});

const GenerateTournamentGroupsInputSchema = z.object({
  numberOfTeams: z.number().describe('The number of teams participating in the tournament.'),
  numberOfGroups: z.number().describe('The number of groups to divide the teams into.'),
  groupFormationStrategy: z
    .enum(['balanced', 'random'])
    .describe(
      'The strategy for forming groups: balanced to ensure groups have roughly the same number of teams, random for arbitrary assignment.'
    ),
  teams: z.array(TeamSchema).describe('The teams participating in the tournament, with their players.'),
  category: z.string().describe('The category of the tournament (e.g., Masculino, Misto).'),
});
export type GenerateTournamentGroupsInput = z.infer<typeof GenerateTournamentGroupsInputSchema>;

const GenerateTournamentGroupsOutputSchema = z.object({
  groups: z.array(
    z.object({
      name: z.string().describe('The name of the group (e.g., Group A, Group B).'),
      teams: z.array(TeamSchema).describe('The teams in this group, with their players.'),
    })
  ).describe('The generated tournament groups.'),
});
export type GenerateTournamentGroupsOutput = z.infer<typeof GenerateTournamentGroupsOutputSchema>;

export async function generateTournamentGroups(
  input: GenerateTournamentGroupsInput
): Promise<GenerateTournamentGroupsOutput> {
  return generateTournamentGroupsFlow(input);
}

const generateTournamentGroupsPrompt = ai.definePrompt({
  name: 'generateTournamentGroupsPrompt',
  input: {schema: GenerateTournamentGroupsInputSchema},
  output: {schema: GenerateTournamentGroupsOutputSchema},
  prompt: `You are a tournament organizer. Your task is to divide the teams into groups for a tournament.

Tournament Category: {{{category}}}
Number of Teams: {{{numberOfTeams}}}
Number of Groups: {{{numberOfGroups}}}
Group Formation Strategy: {{{groupFormationStrategy}}}
Teams:
{{#each teams}}- {{{this.player1}}} / {{{this.player2}}}
{{/each}}

Generate the groups, ensuring that each team is assigned to one group. Consider the group formation strategy when assigning teams. The output for each team must include both player names.

Groups:
`,
});

const generateTournamentGroupsFlow = ai.defineFlow(
  {
    name: 'generateTournamentGroupsFlow',
    inputSchema: GenerateTournamentGroupsInputSchema,
    outputSchema: GenerateTournamentGroupsOutputSchema,
  },
  async input => {
    const {output} = await generateTournamentGroupsPrompt(input);
    return output!;
  }
);
