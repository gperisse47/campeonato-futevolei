"use client"

import * as React from "react"
import { useState, useEffect } from "react"
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
      includeThirdPlace: false,
    },
  })

  const numberOfTeams = form.watch("numberOfTeams")
  const includeThirdPlace = form.watch("includeThirdPlace")
  const teamsPerGroupToAdvance = form.watch("teamsPerGroupToAdvance")
  const numberOfGroups = form.watch("numberOfGroups")

  const teamToKey = (team: Team) => `${team.player1} e ${team.player2}`;

  const initializeStandings = (groups: GenerateTournamentGroupsOutput['groups']): GroupWithScores[] => {
    return groups.map(group => {
      const standings: Record<string, TeamStanding> = {}
      group.teams.forEach(team => {
        const teamKey = teamToKey(team)
        standings[teamKey] = { team, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, setDifference: 0 }
      })
      const sortedStandings = Object.values(standings).sort((a, b) => a.team.player1.localeCompare(b.team.player1))
      return {
        ...group,
        matches: group.matches.map(match => ({ ...match })),
        standings: sortedStandings
      }
    })
  }

  const getTeamPlaceholder = (groupIndex: number, position: number) => {
    const groupLetter = String.fromCharCode(65 + groupIndex);
    return `${position}º do Grupo ${groupLetter}`;
  }

  const generatePlayoffPlaceholders = (totalQualifiers: number): string[] => {
    const placeholders: string[] = [];
    for (let i = 0; i < numberOfGroups; i++) {
        for (let j = 1; j <= teamsPerGroupToAdvance; j++) {
            placeholders.push(getTeamPlaceholder(i, j));
        }
    }
    // Simple seeding: 1A vs 2B, 1B vs 2A etc.
    // A more complex seeding could be implemented here if needed.
    return placeholders;
  }

  const initializePlayoffs = () => {
    const totalQualifiers = numberOfGroups * teamsPerGroupToAdvance;
    
    // Must be a power of 2
    if (totalQualifiers <= 1 || (totalQualifiers & (totalQualifiers - 1)) !== 0) {
        setPlayoffs(null);
        return;
    }

    let bracket: PlayoffBracket = {};
    let placeholders = generatePlayoffPlaceholders(totalQualifiers);
    let round = 1;
    let teamsInRound = totalQualifiers;
    
    const roundNames: { [key: number]: string } = {
      2: 'Final',
      4: 'Semifinais',
      8: 'Quartas de Final',
      16: 'Oitavas de Final'
    };

    while (teamsInRound >= 2) {
      const roundName = roundNames[teamsInRound] || `Rodada ${round}`;
      bracket[roundName] = [];
      const nextRoundPlaceholders = [];
      
      for (let i = 0; i < teamsInRound / 2; i++) {
        bracket[roundName].push({
          team1Placeholder: placeholders[i],
          team2Placeholder: placeholders[teamsInRound - 1 - i],
        });
        nextRoundPlaceholders.push(`Vencedor ${roundName.slice(0, -1)} ${i + 1}`);
      }
      
      placeholders = nextRoundPlaceholders;
      teamsInRound /= 2;
      round++;
    }

    if (includeThirdPlace && bracket['Semifinais']) {
      bracket['Disputa de 3º Lugar'] = [
        { team1Placeholder: "Perdedor Semifinal 1", team2Placeholder: "Perdedor Semifinal 2" }
      ];
    }

    setPlayoffs(bracket);
  }

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
  
  // Re-initialize playoffs if dependent form values change
  // Using useEffect to watch for changes
  useEffect(() => {
    if (tournamentData) { // Only run if groups have been generated
      initializePlayoffs();
    }
  }, [teamsPerGroupToAdvance, numberOfGroups, includeThirdPlace, tournamentData]);


  const calculateStandings = (currentTournamentData: TournamentData): TournamentData => {
    const newGroups = currentTournamentData.groups.map(group => {
      const standings: Record<string, TeamStanding> = {}

      group.teams.forEach(team => {
        const teamKey = teamToKey(team);
        standings[teamKey] = { team, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, setDifference: 0 }
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
        } else {
          standings[team2Key].wins++
          standings[team1Key].losses++
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
        if (b.wins !== a.wins) return b.wins - a.wins
        if (b.setDifference !== a.setDifference) return b.setDifference - a.setDifference
        return b.setsWon - a.setsWon
      })

      return { ...group, standings: sortedStandings }
    })

    return { groups: newGroups }
  }

  const handleScoreChange = (groupIndex: number, matchIndex: number, team: 'team1' | 'team2', value: string) => {
    if (!tournamentData) return
    const newTournamentData = { ...tournamentData }
    const score = value === '' ? undefined : parseInt(value, 10)
    if (team === 'team1') {
      newTournamentData.groups[groupIndex].matches[matchIndex].score1 = isNaN(score!) ? undefined : score
    } else {
      newTournamentData.groups[groupIndex].matches[matchIndex].score2 = isNaN(score!) ? undefined : score
    }

    const updatedDataWithStandings = calculateStandings(newTournamentData)
    setTournamentData(updatedDataWithStandings)
  }

  const PlayoffMatchCard = ({ match }: { match: PlayoffMatch }) => (
    <div className="flex flex-col items-center gap-1">
      <div className="border rounded-md p-2 w-48 text-center bg-secondary/50 text-sm h-10 flex items-center justify-center">
        {match.team1Placeholder}
      </div>
      <div className="text-muted-foreground text-xs">vs</div>
      <div className="border rounded-md p-2 w-48 text-center bg-secondary/50 text-sm h-10 flex items-center justify-center">
        {match.team2Placeholder}
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
                                      <TableHead className="p-2 text-center">J</TableHead>
                                      <TableHead className="p-2 text-center">V</TableHead>
                                      <TableHead className="p-2 text-center">D</TableHead>
                                      <TableHead className="p-2 text-center">SS</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {group.standings.map((standing, index) => (
                                      <TableRow key={teamToKey(standing.team)} className={index < teamsPerGroupToAdvance ? "bg-green-100 dark:bg-green-900/30" : ""}>
                                        <TableCell className="p-2 font-medium">{teamToKey(standing.team)}</TableCell>
                                        <TableCell className="p-2 text-center">{standing.played}</TableCell>
                                        <TableCell className="p-2 text-center">{standing.wins}</TableCell>
                                        <TableCell className="p-2 text-center">{standing.losses}</TableCell>
                                        <TableCell className="p-2 text-center">{standing.setDifference > 0 ? `+${standing.setDifference}` : standing.setDifference}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                          )}
                          
                          <Separator/>

                          <div>
                            <h4 className="mb-2 font-semibold">Jogos</h4>
                            <div className="space-y-2">
                              {group.matches.map((match, matchIndex) => (
                                <div key={matchIndex} className="flex items-center justify-between gap-2 rounded-md bg-secondary/50 p-2 text-sm">
                                  <span className="flex-1 text-right truncate">{teamToKey(match.team1)}</span>
                                  <div className="flex items-center gap-1">
                                    <Input type="number" className="h-7 w-12 text-center" value={match.score1 ?? ''} onChange={(e) => handleScoreChange(groupIndex, matchIndex, 'team1', e.target.value)} />
                                    <span className="text-muted-foreground">x</span>
                                    <Input type="number" className="h-7 w-12 text-center" value={match.score2 ?? ''} onChange={(e) => handleScoreChange(groupIndex, matchIndex, 'team2', e.target.value)} />
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
                       <CardContent className="flex flex-col lg:flex-row items-start justify-center gap-8 lg:gap-4 p-6 overflow-x-auto">
                        
                         {Object.entries(playoffs).map(([roundName, matches]) => (
                            <div key={roundName} className="flex flex-col gap-8">
                                <h4 className="text-lg font-semibold text-center text-primary">{roundName}</h4>
                                <div className="flex flex-col gap-10">
                                {matches.map((match, index) => (
                                    <PlayoffMatchCard key={`${roundName}-${index}`} match={match} />
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
