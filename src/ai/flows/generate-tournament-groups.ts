
'use server';

/**
 * @fileOverview This file defines a Genkit flow for generating tournament groups and matches using AI.
 *
 * - generateTournamentGroups - A function that generates tournament groups and matches based on input parameters.
 * - GenerateTournamentGroupsInput - The input type for the generateTournamentGroups function.
 * - GenerateTournamentGroupsOutput - The return type for the generateTournamentGroups function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const TeamSchema = z.object({
  player1: z.string().describe('The name of the first player in the team.'),
  player2: z.string().describe('The name of the second player in the team.'),
});

const MatchSchema = z.object({
  team1: TeamSchema.describe('The first team in the match.'),
  team2: TeamSchema.describe('The second team in the match.'),
});

const GenerateTournamentGroupsInputSchema = z.object({
  numberOfTeams: z.number().describe('The number of teams participating in the tournament.'),
  numberOfGroups: z.number().optional().describe('The number of groups to divide the teams into. Only for group stage tournaments.'),
  groupFormationStrategy: z
    .enum(['order', 'random'])
    .describe(
      'The strategy for forming groups or seeding: order to ensure groups/matches are balanced, random for arbitrary assignment.'
    ),
  teams: z.array(TeamSchema).describe('The teams participating in the tournament, with their players.'),
  category: z.string().describe('The category of the tournament (e.g., Masculino, Misto).'),
  tournamentType: z.enum(['groups', 'singleElimination', 'doubleElimination']).describe('The type of tournament to generate.'),
});
export type GenerateTournamentGroupsInput = z.infer<typeof GenerateTournamentGroupsInputSchema>;

const GenerateTournamentGroupsOutputSchema = z.object({
  groups: z.array(
    z.object({
      name: z.string().describe('The name of the group (e.g., Group A, Group B).'),
      teams: z.array(TeamSchema).describe('The teams in this group, with their players.'),
      matches: z.array(MatchSchema).describe('The matches to be played in this group (round-robin).'),
    })
  ).describe('The generated tournament groups and their matches. This will be empty if tournamentType is not "groups".'),
  playoffMatches: z.array(MatchSchema).optional().describe('The generated first-round playoff matches for a single or double elimination tournament.'),
});
export type GenerateTournamentGroupsOutput = z.infer<typeof GenerateTournamentGroupsOutputSchema>;

export async function generateTournamentGroups(
  input: GenerateTournamentGroupsInput
): Promise<GenerateTournamentGroupsOutput> {
  return generateTournamentGroupsFlow(input);
}


const PromptInputSchema = GenerateTournamentGroupsInputSchema.extend({
    isGroups: z.boolean(),
    isSingleElimination: z.boolean(),
    isDoubleElimination: z.boolean(),
});


const generateTournamentGroupsPrompt = ai.definePrompt({
  name: 'generateTournamentGroupsPrompt',
  model: 'googleai/gemini-1.5-flash',
  input: {schema: PromptInputSchema},
  output: {schema: GenerateTournamentGroupsOutputSchema},
  prompt: `You are a tournament organizer. Your task is to generate the structure for a futevolei tournament.

Tournament Category: {{{category}}}
Tournament Type: {{{tournamentType}}}
Number of Teams: {{{numberOfTeams}}}
{{#if numberOfGroups}}Number of Groups: {{{numberOfGroups}}}{{/if}}
Seeding Strategy: {{{groupFormationStrategy}}}
Teams:
{{#each teams}}- {{{this.player1}}} e {{{this.player2}}}
{{/each}}

{{#if isGroups}}
Your first step is to ensure the groups are balanced. Divide the total number of teams ({{{numberOfTeams}}}) by the number of groups ({{{numberOfGroups}}}) to determine the size of each group. Distribute the teams to create groups of equal size, or as close to equal as possible (e.g., for 10 teams and 3 groups, create two groups of 3 and one of 4).
Once the group sizes are determined, populate them with the teams using the '{{{groupFormationStrategy}}}' strategy. For 'order', the top seeds should be in different groups. For 'random', the distribution is arbitrary.
After forming the balanced groups, generate a round-robin match schedule for each group, where every team plays against every other team in its group exactly once.
The final output must contain the groups, the teams within each group, and the list of matches for each group. The playoffMatches field should be empty.
{{else}}
{{#if isSingleElimination}}
You need to create the first round of a single elimination (mata-mata) tournament.
Seed the teams based on the '{{{groupFormationStrategy}}}' strategy. If it's 'order', the top seed plays the bottom seed, 2nd plays 2nd-to-last, and so on. If it's 'random', create the matches randomly.
The output should contain the matches in the 'playoffMatches' field. The 'groups' field should be an empty array.
{{else}}
You need to create the first round of the upper bracket for a double elimination tournament.
Seed the teams based on the '{{{groupFormationStrategy}}}' strategy. If it's 'order', the top seed plays the bottom seed, 2nd plays 2nd-to-last, and so on. If it's 'random', create the matches randomly.
The output should contain the first-round matches in the 'playoffMatches' field. The 'groups' field should be an empty array.
{{/if}}
{{/if}}
`,
});

const generateTournamentGroupsFlow = ai.defineFlow(
  {
    name: 'generateTournamentGroupsFlow',
    inputSchema: GenerateTournamentGroupsInputSchema,
    outputSchema: GenerateTournamentGroupsOutputSchema,
  },
  async input => {
    const promptInput = {
        ...input,
        isGroups: input.tournamentType === 'groups',
        isSingleElimination: input.tournamentType === 'singleElimination',
        isDoubleElimination: input.tournamentType === 'doubleElimination',
    };
    const {output} = await generateTournamentGroupsPrompt(promptInput);
    return output!;
  }
);
