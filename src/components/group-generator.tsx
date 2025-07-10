"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Trophy } from "lucide-react"

import { generateGroupsAction } from "@/app/actions"
import type { TournamentData, TeamStanding, PlayoffMatch, GroupWithScores, TournamentFormValues, Team, GenerateTournamentGroupsOutput } from "@/lib/types"
import { formSchema } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "./ui/skeleton"
import { Separator } from "./ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Switch } from "./ui/switch"

type PlayoffBracket = {
  [round: string]: PlayoffMatch[];
};

const roundNames: { [key: number]: string } = {
  2: 'Final',
  4: 'Semifinais',
  8: 'Quartas de Final',
  16: 'Oitavas de Final'
};

export function GroupGenerator() {
  const [isLoading, setIsLoading] = useState(false)
  const [tournamentData, setTournamentData] = useState<TournamentData | null>(null)
  const [playoffs, setPlayoffs] = useState<PlayoffBracket | null>(null)
  const { toast } = useToast()

  const form = useForm<TournamentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      category: "Masculino",
      numberOfTeams: 8,
      numberOfGroups: 2,
      teamsPerGroupToAdvance: 2,
      teams: "Ana e Bia\nCarla e Dani\nElena e Fernanda\nGabi e Helo\nIsis e Julia\nKarla e Laura\nMaria e Nina\nOlivia e Paula",
      groupFormationStrategy: "balanced",
      includeThirdPlace: true,
    },
  })

  const { teamsPerGroupToAdvance, numberOfGroups, includeThirdPlace, numberOfTeams } = form.watch()

  const teamToKey = (team: Team) => `${team.player1} e ${team.player2}`;

  const initializeStandings = (groups: GenerateTournamentGroupsOutput['groups']): GroupWithScores[] => {
    return groups.map(group => {
      const standings: Record<string, TeamStanding> = {}
      group.teams.forEach(team => {
        const teamKey = teamToKey(team)
        standings[teamKey] = { team, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, setDifference: 0, points: 0 }
      })
      const sortedStandings = Object.values(standings).sort((a, b) => a.team.player1.localeCompare(b.team.player1))
      return {
        ...group,
        matches: group.matches.map(match => ({ ...match })),
        standings: sortedStandings
      }
    })
  }

  const getTeamPlaceholder = useCallback((groupIndex: number, position: number) => {
    const groupLetter = String.fromCharCode(65 + groupIndex);
    return `${position}º do Grupo ${groupLetter}`;
  }, []);

  const generatePlayoffPlaceholders = useCallback((totalQualifiers: number): { [key: string]: string } => {
    const placeholders: { [key: string]: string } = {};
    const teamsToSeed = [];
    for (let i = 0; i < numberOfGroups; i++) {
      for (let j = 1; j <= teamsPerGroupToAdvance; j++) {
        teamsToSeed.push(getTeamPlaceholder(i, j));
      }
    }

    // Simple seeding: 1A vs 2B, 1B vs 2A etc.
    // This creates pairs for the first round.
    for (let i = 0; i < totalQualifiers / 2; i++) {
      placeholders[teamsToSeed[i]] = teamsToSeed[i];
      placeholders[teamsToSeed[totalQualifiers - 1 - i]] = teamsToSeed[totalQualifiers - 1 - i];
    }
    return placeholders;
  }, [numberOfGroups, teamsPerGroupToAdvance, getTeamPlaceholder]);

  const initializePlayoffs = useCallback(() => {
    const totalQualifiers = numberOfGroups * teamsPerGroupToAdvance;

    if (totalQualifiers <= 1 || (totalQualifiers & (totalQualifiers - 1)) !== 0) {
      setPlayoffs(null);
      return;
    }
  
    let bracket: PlayoffBracket = {};
    const placeholders = generatePlayoffPlaceholders(totalQualifiers);
    const teamPlaceholders = Object.keys(placeholders);
  
    let round = 1;
    let teamsInRound = totalQualifiers;
    
    let currentRoundTeams = [...teamPlaceholders];
    while (teamsInRound >= 2) {
      const roundName = roundNames[teamsInRound] || `Rodada ${round}`;
      bracket[roundName] = [];
      const nextRoundTeams = [];
  
      for (let i = 0; i < currentRoundTeams.length / 2; i++) {
        const matchIndex = bracket[roundName].length;
        bracket[roundName].push({
          team1Placeholder: currentRoundTeams[i*2],
          team2Placeholder: currentRoundTeams[i*2 + 1],
        });
        nextRoundTeams.push(`Vencedor ${roundName} ${matchIndex + 1}`);
      }
  
      currentRoundTeams = nextRoundTeams;
      teamsInRound /= 2;
      round++;
    }
  
    if (includeThirdPlace && bracket['Semifinais']) {
      bracket['Disputa de 3º Lugar'] = [
        { team1Placeholder: "Perdedor Semifinal 1", team2Placeholder: "Perdedor Semifinal 2" }
      ];
    }

    setPlayoffs(bracket);
  }, [numberOfGroups, teamsPerGroupToAdvance, includeThirdPlace, generatePlayoffPlaceholders]);

  const updatePlayoffs = useCallback(() => {
    if (!tournamentData || !playoffs) return;
  
    let allGroupMatchesPlayed = tournamentData.groups.every(g => g.matches.every(m => m.score1 !== undefined && m.score2 !== undefined));
    let qualifiedTeams: { [placeholder: string]: Team } = {};
  
    if (allGroupMatchesPlayed) {
      tournamentData.groups.forEach((group, groupIndex) => {
        // Correct seeding (1A vs 2B, 1B vs 2A, ...)
        const groupQualifiers = group.standings.slice(0, teamsPerGroupToAdvance);
        groupQualifiers.forEach((standing, standingIndex) => {
            const placeholder = getTeamPlaceholder(groupIndex, standingIndex + 1);
            qualifiedTeams[placeholder] = standing.team;
        });
      });
    }
  
    const newPlayoffs = JSON.parse(JSON.stringify(playoffs)) as PlayoffBracket;
    let losers: { [roundName: string]: { [matchIndex: number]: Team } } = { 'Semifinais': {} };

    const getRoundNameForTeams = (numTeams: number) => roundNames[numTeams] || null;
    
    const roundOrder = Object.keys(newPlayoffs)
      .map(roundName => ({
        name: roundName,
        teams: Object.values(roundNames).includes(roundName)
          ? parseInt(Object.entries(roundNames).find(([, name]) => name === roundName)![0])
          : 0,
      }))
      .sort((a, b) => b.teams - a.teams)
      .map(r => r.name)
      .filter(name => name !== 'Disputa de 3º Lugar');


    let previousRoundName: string | null = null;
    
    roundOrder.forEach(roundName => {
        const matches = newPlayoffs[roundName];
        matches.forEach((match, matchIndex) => {
            // Assign teams for the first round from group stage
            if (!previousRoundName) {
                if (qualifiedTeams[match.team1Placeholder]) match.team1 = qualifiedTeams[match.team1Placeholder];
                if (qualifiedTeams[match.team2Placeholder]) match.team2 = qualifiedTeams[match.team2Placeholder];
            } else { // Assign teams from previous playoff round
                const prevRoundMatches = newPlayoffs[previousRoundName!];
                
                const team1WinnerMatch = prevRoundMatches[matchIndex * 2];
                if (team1WinnerMatch?.score1 !== undefined && team1WinnerMatch?.score2 !== undefined) {
                    match.team1 = team1WinnerMatch.score1 > team1WinnerMatch.score2 ? team1WinnerMatch.team1 : team1WinnerMatch.team2;
                }

                const team2WinnerMatch = prevRoundMatches[matchIndex * 2 + 1];
                 if (team2WinnerMatch?.score1 !== undefined && team2WinnerMatch?.score2 !== undefined) {
                    match.team2 = team2WinnerMatch.score1 > team2WinnerMatch.score2 ? team2WinnerMatch.team2 : team2WinnerMatch.team1;
                }
            }

            // Store losers from semifinals for 3rd place match
            if (roundName === 'Semifinais' && match.team1 && match.team2 && match.score1 !== undefined && match.score2 !== undefined) {
                const loser = match.score1 < match.score2 ? match.team1 : match.team2;
                losers['Semifinais'][matchIndex] = loser;
            }
        });
        previousRoundName = roundName;
    });
  
    // Handle 3rd place match
    if (newPlayoffs['Disputa de 3º Lugar'] && losers['Semifinais'][0] && losers['Semifinais'][1]) {
        newPlayoffs['Disputa de 3º Lugar'][0].team1 = losers['Semifinais'][0];
        newPlayoffs['Disputa de 3º Lugar'][0].team2 = losers['Semifinais'][1];
    }
  
    setPlayoffs(newPlayoffs);
  }, [tournamentData, playoffs, teamsPerGroupToAdvance, getTeamPlaceholder]);


  async function onSubmit(values: TournamentFormValues) {
    setIsLoading(true)
    setTournamentData(null)
    setPlayoffs(null)

    const teamsArray: Team[] = values.teams
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((teamString) => {
        const players = teamString.split(" e ").map((p) => p.trim())
        return { player1: players[0], player2: players[1] }
      })

    const result = await generateGroupsAction({
      numberOfTeams: values.numberOfTeams,
      numberOfGroups: values.numberOfGroups,
      groupFormationStrategy: values.groupFormationStrategy,
      teams: teamsArray,
      category: values.category,
    })

    if (result.success && result.data) {
      const groupsWithInitialStandings = initializeStandings(result.data.groups)
      setTournamentData({ groups: groupsWithInitialStandings })
      initializePlayoffs()
      toast({
        title: "Grupos e Jogos Gerados!",
        description: "Os grupos e confrontos estão prontos. Preencha os resultados.",
      })
    } else {
      toast({
        variant: "destructive",
        title: "Erro ao Gerar",
        description: result.error || "Ocorreu um erro inesperado.",
      })
    }
    setIsLoading(false)
  }

  useEffect(() => {
    if (tournamentData) {
      initializePlayoffs();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsPerGroupToAdvance, numberOfGroups, includeThirdPlace, tournamentData]);


  const calculateStandings = (currentTournamentData: TournamentData): TournamentData => {
    const newGroups = currentTournamentData.groups.map(group => {
      const standings: Record<string, TeamStanding> = {}

      group.teams.forEach(team => {
        const teamKey = teamToKey(team);
        standings[teamKey] = { team, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, setDifference: 0, points: 0 }
      })

      group.matches.forEach(match => {
        const { team1, team2, score1, score2 } = match
        if (score1 === undefined || score2 === undefined) return

        const team1Key = teamToKey(team1);
        const team2Key = teamToKey(team2);

        standings[team1Key].played++
        standings[team2Key].played++

        if (score1 > score2) {
          standings[team1Key].wins++
          standings[team2Key].losses++
          standings[team1Key].points += 2
          standings[team2Key].points += 1
        } else {
          standings[team2Key].wins++
          standings[team1Key].losses++
          standings[team2Key].points += 2
          standings[team1Key].points += 1
        }

        standings[team1Key].setsWon += score1
        standings[team1Key].setsLost += score2
        standings[team2Key].setsWon += score2
        standings[team2Key].setsLost += score1
      })

      const sortedStandings = Object.values(standings).map(s => ({
        ...s,
        setDifference: s.setsWon - s.setsLost
      })).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points
        if (b.wins !== a.wins) return b.wins - a.wins
        if (b.setDifference !== a.setDifference) return b.setDifference - a.setDifference
        return b.setsWon - a.setsWon
      })

      return { ...group, standings: sortedStandings }
    })

    return { groups: newGroups }
  }

  const handleScoreChange = (groupIndex: number, matchIndex: number, team: 'team1' | 'team2', value: string) => {
    if (!tournamentData) return;
    let newTournamentData = JSON.parse(JSON.stringify(tournamentData));
    const score = value === '' ? undefined : parseInt(value, 10);
    if (team === 'team1') {
      newTournamentData.groups[groupIndex].matches[matchIndex].score1 = isNaN(score!) ? undefined : score;
    } else {
      newTournamentData.groups[groupIndex].matches[matchIndex].score2 = isNaN(score!) ? undefined : score;
    }
    const updatedDataWithStandings = calculateStandings(newTournamentData);
    setTournamentData(updatedDataWithStandings);
  }

  const handlePlayoffScoreChange = (roundName: string, matchIndex: number, team: 'team1' | 'team2', value: string) => {
    if (!playoffs) return;
    let newPlayoffs = JSON.parse(JSON.stringify(playoffs));
    const score = value === '' ? undefined : parseInt(value, 10);

    if (team === 'team1') {
      newPlayoffs[roundName][matchIndex].score1 = isNaN(score!) ? undefined : score;
    } else {
      newPlayoffs[roundName][matchIndex].score2 = isNaN(score!) ? undefined : score;
    }
    setPlayoffs(newPlayoffs);
  };
  
  useEffect(() => {
    updatePlayoffs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentData, JSON.stringify(playoffs?.['Quartas de Final']), JSON.stringify(playoffs?.['Semifinais']), JSON.stringify(playoffs?.['Final'])]
);
  
  const PlayoffMatchCard = ({ match, roundName, matchIndex }: { match: PlayoffMatch, roundName: string, matchIndex: number }) => (
      <div className="flex flex-col items-center justify-center gap-2 w-full">
          <div className="flex items-center w-full">
              <span className="flex-1 text-right truncate pr-2 text-sm">{match.team1 ? teamToKey(match.team1) : match.team1Placeholder}</span>
              <Input
                  type="number"
                  className="h-8 w-14 text-center"
                  value={match.score1 ?? ''}
                  onChange={(e) => handlePlayoffScoreChange(roundName, matchIndex, 'team1', e.target.value)}
                  disabled={!match.team1 || !match.team2}
              />
          </div>
          <div className="text-muted-foreground text-xs">vs</div>
          <div className="flex items-center w-full">
              <span className="flex-1 text-right truncate pr-2 text-sm">{match.team2 ? teamToKey(match.team2) : match.team2Placeholder}</span>
              <Input
                  type="number"
                  className="h-8 w-14 text-center"
                  value={match.score2 ?? ''}
                  onChange={(e) => handlePlayoffScoreChange(roundName, matchIndex, 'team2', e.target.value)}
                  disabled={!match.team1 || !match.team2}
              />
          </div>
      </div>
  );


  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Configurações do Torneio</CardTitle>
            <CardDescription>
              Insira os detalhes para a geração dos grupos e jogos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Categoria</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Masculino, Misto" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="numberOfTeams"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nº de Duplas</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="numberOfGroups"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nº de Grupos</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="teamsPerGroupToAdvance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Classificados por Grupo</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="teams"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duplas (uma por linha)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Jogador A e Jogador B"
                          className="min-h-[120px] resize-y"
                          rows={numberOfTeams > 0 ? numberOfTeams : 4}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Use o formato: Jogador1 e Jogador2
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="groupFormationStrategy"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>Estratégia de Formação</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className="flex flex-col space-y-1"
                        >
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="balanced" />
                            </FormControl>
                            <FormLabel className="font-normal">
                              Ordem
                            </FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="random" />
                            </FormControl>
                            <FormLabel className="font-normal">
                              Aleatório (Sorteio)
                            </FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="includeThirdPlace"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>Disputa de 3º Lugar</FormLabel>
                        <FormDescription>
                          Incluir um jogo para definir o terceiro lugar.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Gerar Grupos e Jogos
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          <Card className="min-h-full">
            <CardHeader>
              <CardTitle>Grupos e Jogos Gerados</CardTitle>
              <CardDescription>
                Visualize os grupos, preencha os resultados e gere os playoffs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {[...Array(form.getValues("numberOfGroups"))].map((_, i) => (
                    <Card key={i}>
                      <CardHeader>
                        <Skeleton className="h-6 w-24" />
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <Skeleton className="h-5 w-full" />
                        <Skeleton className="h-5 w-5/6" />
                        <Skeleton className="h-5 w-full" />
                        <Skeleton className="h-5 w-4/6" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              {tournamentData && (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {tournamentData.groups.map((group, groupIndex) => (
                      <Card key={group.name} className="flex flex-col">
                        <CardHeader>
                          <CardTitle className="text-primary">{group.name}</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-1 flex-col space-y-4">

                          {group.standings && (
                            <div>
                              <h4 className="mb-2 font-semibold">Classificação</h4>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="p-2">Dupla</TableHead>
                                    <TableHead className="p-2 text-center">Pts</TableHead>
                                    <TableHead className="p-2 text-center">J</TableHead>
                                    <TableHead className="p-2 text-center">V</TableHead>
                                    <TableHead className="p-2 text-center">SS</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {group.standings.map((standing, index) => (
                                    <TableRow key={teamToKey(standing.team)} className={index < teamsPerGroupToAdvance ? "bg-green-100 dark:bg-green-900/30" : ""}>
                                      <TableCell className="p-2 font-medium">{teamToKey(standing.team)}</TableCell>
                                      <TableCell className="p-2 text-center">{standing.points}</TableCell>
                                      <TableCell className="p-2 text-center">{standing.played}</TableCell>
                                      <TableCell className="p-2 text-center">{standing.wins}</TableCell>
                                      <TableCell className="p-2 text-center">{standing.setDifference > 0 ? `+${standing.setDifference}` : standing.setDifference}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}

                          <Separator />

                          <div>
                            <h4 className="mb-2 font-semibold">Jogos</h4>
                            <div className="space-y-2">
                              {group.matches.map((match, matchIndex) => (
                                <div key={matchIndex} className="flex items-center justify-between gap-2 rounded-md bg-secondary/50 p-2 text-sm">
                                  <span className="flex-1 text-right truncate">{teamToKey(match.team1)}</span>
                                  <div className="flex items-center gap-1">
                                    <Input type="number" className="h-7 w-14 text-center" value={match.score1 ?? ''} onChange={(e) => handleScoreChange(groupIndex, matchIndex, 'team1', e.target.value)} />
                                    <span className="text-muted-foreground">x</span>
                                    <Input type="number" className="h-7 w-14 text-center" value={match.score2 ?? ''} onChange={(e) => handleScoreChange(groupIndex, matchIndex, 'team2', e.target.value)} />
                                  </div>
                                  <span className="flex-1 text-left truncate">{teamToKey(match.team2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {playoffs && Object.keys(playoffs).length > 0 && (
                     <Card>
                       <CardHeader>
                         <CardTitle className="flex items-center"><Trophy className="mr-2 h-5 w-5 text-primary" />Playoffs - Mata-Mata</CardTitle>
                         <CardDescription>Chaveamento gerado com base na classificação dos grupos.</CardDescription>
                       </CardHeader>
                       <CardContent className="flex flex-col lg:flex-row items-start justify-center gap-8 lg:gap-12 p-6 overflow-x-auto">
                       {Object.entries(playoffs)
                        .sort(([roundNameA], [roundNameB]) => {
                            const order = ['Quartas de Final', 'Semifinais', 'Disputa de 3º Lugar', 'Final'];
                            return order.indexOf(roundNameA) - order.indexOf(roundNameB);
                        })
                        .map(([roundName, matches]) => (
                            <div key={roundName} className="flex flex-col items-center gap-6">
                                <h4 className="text-lg font-semibold text-center text-primary whitespace-nowrap">{roundName}</h4>
                                <div className="flex flex-col gap-10">
                                {matches.map((match, index) => (
                                    <PlayoffMatchCard key={`${roundName}-${index}`} match={match} roundName={roundName} matchIndex={index}/>
                                ))}
                                </div>
                            </div>
                         ))}
                       </CardContent>
                     </Card>
                  )}
                </div>
              )}
              {!isLoading && !tournamentData && (
                <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg h-full">
                  <p className="text-muted-foreground">Os grupos e jogos aparecerão aqui após a geração.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
