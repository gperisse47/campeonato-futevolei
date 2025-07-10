"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Swords, Trophy } from "lucide-react"

import { generateGroupsAction } from "@/app/actions"
import type { TournamentData, TeamStanding, PlayoffMatch, MatchWithScore, GroupWithScores, TournamentFormValues, Team, GenerateTournamentGroupsOutput } from "@/lib/types"
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

export function GroupGenerator() {
  const [isLoading, setIsLoading] = useState(false)
  const [tournamentData, setTournamentData] = useState<TournamentData | null>(null)
  const [playoffs, setPlayoffs] = useState<PlayoffMatch[] | null>(null)
  const { toast } = useToast()

  const form = useForm<TournamentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      category: "Masculino",
      numberOfTeams: 8,
      numberOfGroups: 2,
      teams: "Ana/Bia, Carla/Dani, Elena/Fernanda, Gabi/Helo, Isis/Julia, Karla/Laura, Maria/Nina, Olivia/Paula",
      groupFormationStrategy: "balanced",
    },
  })

  const initializeStandings = (groups: GenerateTournamentGroupsOutput['groups']): GroupWithScores[] => {
    return groups.map(group => {
      const standings: Record<string, TeamStanding> = {}
      group.teams.forEach(team => {
        const teamKey = `${team.player1}/${team.player2}`
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

  const initializePlayoffs = (groups: GroupWithScores[]) => {
    if (groups.length === 2 && groups.every(g => g.teams.length >= 4)) {
      const newPlayoffs: PlayoffMatch[] = [
        { team1Placeholder: "1º do Grupo A", team2Placeholder: "4º do Grupo B" },
        { team1Placeholder: "2º do Grupo B", team2Placeholder: "3º do Grupo A" },
        { team1Placeholder: "2º do Grupo A", team2Placeholder: "3º do Grupo B" },
        { team1Placeholder: "1º do Grupo B", team2Placeholder: "4º do Grupo A" },
      ]
      setPlayoffs(newPlayoffs)
    } else if (groups.length >= 2) {
      const newPlayoffs: PlayoffMatch[] = [
        { team1Placeholder: "1º do Grupo A", team2Placeholder: "2º do Grupo B" },
        { team1Placeholder: "1º do Grupo B", team2Placeholder: "2º do Grupo A" },
      ]
      setPlayoffs(newPlayoffs)
    } else {
      setPlayoffs(null)
    }
  }

  async function onSubmit(values: TournamentFormValues) {
    setIsLoading(true)
    setTournamentData(null)
    setPlayoffs(null)

    const teamsArray: Team[] = values.teams
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((teamString) => {
        const players = teamString.split("/").map((p) => p.trim())
        return { player1: players[0], player2: players[1] }
      })

    const result = await generateGroupsAction({
      ...values,
      teams: teamsArray,
    })

    if (result.success && result.data) {
      const groupsWithInitialStandings = initializeStandings(result.data.groups)
      setTournamentData({ groups: groupsWithInitialStandings })
      initializePlayoffs(groupsWithInitialStandings)
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

  const calculateStandings = (currentTournamentData: TournamentData): TournamentData => {
    const newGroups = currentTournamentData.groups.map(group => {
      const standings: Record<string, TeamStanding> = {}

      group.teams.forEach(team => {
        const teamKey = `${team.player1}/${team.player2}`
        standings[teamKey] = { team, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, setDifference: 0 }
      })

      group.matches.forEach(match => {
        const { team1, team2, score1, score2 } = match
        if (score1 === undefined || score2 === undefined) return

        const team1Key = `${team1.player1}/${team1.player2}`
        const team2Key = `${team2.player1}/${team2.player2}`

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
                          <Input type="number" {...field} />
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
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="teams"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duplas (Jogadores)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Separe duplas por vírgula e jogadores por barra. Ex: Jogador A/Jogador B, Jogador C/Jogador D"
                          className="min-h-[120px]"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Use o formato: Jogador1/Jogador2, Jogador3/Jogador4
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
                              Balanceado
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
                          <div>
                            <h4 className="mb-2 font-semibold">Duplas</h4>
                            <ul className="space-y-1">
                              {group.teams.map((team, index) => (
                                <li key={`${team.player1}-${index}`} className="rounded-md bg-secondary/50 p-2 text-sm text-secondary-foreground">
                                  {team.player1} / {team.player2}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <Separator/>
                          <div>
                            <h4 className="mb-2 font-semibold">Jogos</h4>
                            <ul className="space-y-2">
                                {group.matches.map((match, matchIndex) => (
                                    <li key={matchIndex} className="flex items-center justify-between gap-2 rounded-md bg-secondary/50 p-2 text-sm text-secondary-foreground">
                                        <span className="text-right flex-1">{match.team1.player1}/{match.team1.player2}</span>
                                        <div className="flex items-center gap-1">
                                          <Input type="number" className="h-7 w-12 text-center" value={match.score1 ?? ''} onChange={(e) => handleScoreChange(groupIndex, matchIndex, 'team1', e.target.value)} />
                                          <Swords className="h-4 w-4 text-primary"/>
                                          <Input type="number" className="h-7 w-12 text-center" value={match.score2 ?? ''} onChange={(e) => handleScoreChange(groupIndex, matchIndex, 'team2', e.target.value)} />
                                        </div>
                                        <span className="text-left flex-1">{match.team2.player1}/{match.team2.player2}</span>
                                    </li>
                                ))}
                            </ul>
                          </div>
                          {group.standings && (
                            <>
                              <Separator/>
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
                                    {group.standings.map((standing) => (
                                      <TableRow key={`${standing.team.player1}-${standing.team.player2}`}>
                                        <TableCell className="p-2 font-medium">{standing.team.player1}/{standing.team.player2}</TableCell>
                                        <TableCell className="p-2 text-center">{standing.played}</TableCell>
                                        <TableCell className="p-2 text-center">{standing.wins}</TableCell>
                                        <TableCell className="p-2 text-center">{standing.losses}</TableCell>
                                        <TableCell className="p-2 text-center">{standing.setDifference > 0 ? `+${standing.setDifference}` : standing.setDifference}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {playoffs && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center"><Trophy className="mr-2 h-5 w-5 text-primary" />Playoffs - Mata-Mata</CardTitle>
                        <CardDescription>Chaveamento gerado com base na classificação dos grupos.</CardDescription>
                      </CardHeader>
                      <CardContent className="flex justify-center p-6">
                        <div className="space-y-4">
                          {playoffs.map((match, index) => (
                             <div key={index} className="flex items-center gap-4">
                               <div className="border rounded-md p-3 w-48 text-center bg-secondary/50">
                                {match.team1Placeholder}
                               </div>
                               <div className="text-primary font-bold">VS</div>
                               <div className="border rounded-md p-3 w-48 text-center bg-secondary/50">
                                {match.team2Placeholder}
                               </div>
                             </div>
                          ))}
                        </div>
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
