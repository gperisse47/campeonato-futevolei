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
import { Label } from "./ui/label"


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

    let currentRoundTeams = [...teamPlaceholders];
    let teamsInRound = totalQualifiers;
    let roundCounter = 1;

    while (teamsInRound >= 2) {
      const roundName = roundNames[teamsInRound] || `Rodada ${roundCounter}`;
      bracket[roundName] = [];
      const nextRoundTeams = [];

      for (let i = 0; i < currentRoundTeams.length / 2; i++) {
        const matchIndex = bracket[roundName].length;
        const matchId = `${roundName}-${i + 1}`;
        bracket[roundName].push({
          id: matchId,
          team1Placeholder: currentRoundTeams[i * 2],
          team2Placeholder: currentRoundTeams[i * 2 + 1],
        });
        nextRoundTeams.push(`Vencedor ${matchId}`);
      }

      currentRoundTeams = nextRoundTeams;
      teamsInRound /= 2;
      roundCounter++;
    }

    if (includeThirdPlace && bracket['Semifinais']) {
      bracket['Disputa de 3º Lugar'] = [
        { id: 'terceiro-lugar-1', team1Placeholder: "Perdedor Semifinais-1", team2Placeholder: "Perdedor Semifinais-2" }
      ];
    }

    setPlayoffs(bracket);
  }, [numberOfGroups, teamsPerGroupToAdvance, includeThirdPlace, generatePlayoffPlaceholders]);


  const updatePlayoffs = useCallback(() => {
    if (!tournamentData || !playoffs) return;
  
    const allGroupMatchesPlayed = tournamentData.groups.every(g =>
      g.matches.every(m => m.score1 !== undefined && m.score2 !== undefined)
    );
  
    const qualifiedTeams: { [placeholder: string]: Team } = {};
    if (allGroupMatchesPlayed) {
      const groupQualifiers: Team[] = [];
      const teamsByGroup: Team[][] = [];
      tournamentData.groups.forEach(group => {
        teamsByGroup.push(group.standings.slice(0, teamsPerGroupToAdvance).map(s => s.team));
      });
  
      // Smart seeding (1A vs 2B, 1B vs 2A)
      for(let i=0; i < teamsByGroup.length / 2; i++) {
        const groupA = teamsByGroup[i];
        const groupB = teamsByGroup[teamsByGroup.length - 1 - i];
        for(let j=0; j < teamsPerGroupToAdvance; j++) {
            groupQualifiers.push(groupA[j]);
            groupQualifiers.push(groupB[teamsPerGroupToAdvance - 1- j]);
        }
      }
  
      tournamentData.groups.forEach((group, groupIndex) => {
        group.standings.slice(0, teamsPerGroupToAdvance).forEach((standing, standingIndex) => {
          const placeholder = getTeamPlaceholder(groupIndex, standingIndex + 1);
          qualifiedTeams[placeholder] = standing.team;
        });
      });
    }
  
    const newPlayoffs = JSON.parse(JSON.stringify(playoffs)) as PlayoffBracket;
    const roundOrder = Object.keys(roundNames)
      .map(Number)
      .sort((a,b) => b-a)
      .map(key => roundNames[key])
      .filter(roundName => newPlayoffs[roundName]);
  
    if(newPlayoffs['Disputa de 3º Lugar']) {
        roundOrder.push('Disputa de 3º Lugar');
    }
  
    const winners: { [matchId: string]: Team | undefined } = {};
    const losers: { [matchId: string]: Team | undefined } = {};
  
    roundOrder.forEach(roundName => {
      newPlayoffs[roundName].forEach(match => {
        // Assign teams from placeholders or previous matches
        if (!match.team1) {
           match.team1 = qualifiedTeams[match.team1Placeholder] || winners[match.team1Placeholder] || undefined;
        }
        if (!match.team2) {
          match.team2 = qualifiedTeams[match.team2Placeholder] || winners[match.team2Placeholder] || undefined;
        }
        
         if (roundName === 'Disputa de 3º Lugar') {
             if(!match.team1) match.team1 = losers['Semifinais-1'];
             if(!match.team2) match.team2 = losers['Semifinais-2'];
         }
  
        // Determine winner and loser
        if (match.team1 && match.team2 && typeof match.score1 === 'number' && typeof match.score2 === 'number') {
          if (match.score1 > match.score2) {
            winners[`Vencedor ${match.id}`] = match.team1;
            losers[match.id] = match.team2;
          } else {
            winners[`Vencedor ${match.id}`] = match.team2;
            losers[match.id] = match.team1;
          }
        }
      });
    });
  
    // Only update state if there's a change to avoid loops
    if (JSON.stringify(playoffs) !== JSON.stringify(newPlayoffs)) {
        setPlayoffs(newPlayoffs);
    }
  
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
  }, [teamsPerGroupToAdvance, numberOfGroups, includeThirdPlace]);


  const calculateStandings = (currentTournamentData: TournamentData): TournamentData => {
    const newGroups = currentTournamentData.groups.map(group => {
      const standings: Record<string, TeamStanding> = {}

      group.teams.forEach(team => {
        const teamKey = teamToKey(team);
        standings[teamKey] = { team, played: 0, wins: 0, points: 0, losses: 0, setsWon: 0, setsLost: 0, setDifference: 0 }
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
  }, [tournamentData, JSON.stringify(playoffs)]);
  
  const PlayoffMatchCard = ({ match, roundName, matchIndex, isFinal = false, isThirdPlace = false }: { match: PlayoffMatch, roundName: string, matchIndex: number, isFinal?: boolean, isThirdPlace?: boolean }) => {
    const winner = (m: PlayoffMatch) => {
      if(m.score1 === undefined || m.score2 === undefined) return null;
      if(m.score1 > m.score2) return m.team1;
      if(m.score2 > m.score1) return m.team2;
      return null;
    }

    const winnerTeam = winner(match);
    const winnerKey = winnerTeam ? teamToKey(winnerTeam) : null;
    
    return (
      <div className={`relative flex flex-col items-center justify-center gap-2 w-full ${isFinal || isThirdPlace ? 'pt-8' : ''}`}>
           {isThirdPlace && <h4 className="absolute -top-2 text-sm font-semibold text-center text-primary whitespace-nowrap">Disputa de 3º Lugar</h4>}
            <div className={`flex items-center w-full p-2 rounded-md ${winnerKey && match.team1 && winnerKey === teamToKey(match.team1) ? 'bg-green-100 dark:bg-green-900/30' : 'bg-secondary/50'}`}>
                <span className="flex-1 text-right truncate pr-2 text-sm">{match.team1 ? teamToKey(match.team1) : match.team1Placeholder}</span>
                <Input
                    type="number"
                    className="h-8 w-14 text-center"
                    value={match.score1 ?? ''}
                    onChange={(e) => handlePlayoffScoreChange(roundName, matchIndex, 'team1', e.target.value)}
                    disabled={!match.team1 || !match.team2}
                />
            </div>
            {!isFinal && !isThirdPlace && <div className="text-muted-foreground text-xs py-1">vs</div>}
            
            <div className={`flex items-center w-full p-2 rounded-md ${winnerKey && match.team2 && winnerKey === teamToKey(match.team2) ? 'bg-green-100 dark:bg-green-900/30' : 'bg-secondary/50'}`}>
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
  )};

  const Bracket = ({ playoffs }: { playoffs: PlayoffBracket }) => {
    const roundOrder = Object.keys(roundNames)
      .map(Number)
      .sort((a,b) => b-a)
      .map(key => roundNames[key])
      .filter(roundName => playoffs[roundName]);
    
    const finalMatch = playoffs['Final'] ? playoffs['Final'][0] : null;
    const thirdPlaceMatch = playoffs['Disputa de 3º Lugar'] ? playoffs['Disputa de 3º Lugar'][0] : null;
    
    // Remove Final and 3rd place from the main bracket flow to render them centrally
    const mainBracketRounds = roundOrder.filter(r => r !== 'Final' && r !== 'Disputa de 3º Lugar');
    const midPoint = mainBracketRounds.length;

    const leftRounds = mainBracketRounds.slice(0, midPoint);
    const rightRounds = mainBracketRounds.slice(0, midPoint).reverse();
    
    const getMatchesForSide = (side: 'left' | 'right', roundName: string) => {
        const matches = playoffs[roundName];
        if(!matches) return [];
        const half = Math.ceil(matches.length / 2);
        return side === 'left' ? matches.slice(0, half) : matches.slice(half);
    }
  
    return (
      <div className="flex justify-between items-center w-full overflow-x-auto p-4 gap-4">
        {/* Left Bracket */}
        <div className="flex items-center gap-8">
            {leftRounds.map(roundName => (
                <div key={`${roundName}-left`} className="flex flex-col justify-around gap-12">
                     <h4 className="text-lg font-semibold text-center text-primary whitespace-nowrap">{roundName}</h4>
                     <div className="flex flex-col justify-around gap-12">
                        {getMatchesForSide('left', roundName).map((match, index) => (
                           <div key={match.id} className="relative">
                               <PlayoffMatchCard match={match} roundName={roundName} matchIndex={index}/>
                               <div className="absolute top-1/2 -right-4 h-1/2 w-px bg-border -translate-y-[calc(50%_-_1px)]" />
                               <div className="absolute top-1/2 -right-4 h-px w-4 bg-border" />
                           </div>
                        ))}
                     </div>
                </div>
            ))}
        </div>

        {/* Center Column - Final and 3rd Place */}
        <div className="flex flex-col items-center justify-center gap-12 px-8">
            {finalMatch && (
                 <div className="flex flex-col items-center">
                    <h4 className="text-xl font-bold text-center text-primary whitespace-nowrap">Final</h4>
                    <PlayoffMatchCard match={finalMatch} roundName="Final" matchIndex={0} isFinal/>
                 </div>
            )}
            {thirdPlaceMatch && (
                <PlayoffMatchCard match={thirdPlaceMatch} roundName="Disputa de 3º Lugar" matchIndex={0} isThirdPlace/>
            )}
        </div>
        
        {/* Right Bracket */}
        <div className="flex items-center gap-8">
             {rightRounds.map(roundName => (
                <div key={`${roundName}-right`} className="flex flex-col justify-around gap-12">
                     <h4 className="text-lg font-semibold text-center text-primary whitespace-nowrap">{roundName}</h4>
                     <div className="flex flex-col justify-around gap-12">
                        {getMatchesForSide('right', roundName).map((match, index) => (
                            <div key={match.id} className="relative">
                                <PlayoffMatchCard match={match} roundName={roundName} matchIndex={index + getMatchesForSide('left', roundName).length}/>
                                <div className="absolute top-1/2 -left-4 h-1/2 w-px bg-border -translate-y-[calc(50%_-_1px)]" />
                                <div className="absolute top-1/2 -left-4 h-px w-4 bg-border" />
                            </div>
                        ))}
                     </div>
                </div>
            ))}
        </div>
      </div>
    );
  };


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
                          <div className="flex items-center space-x-3 space-y-0">
                              <RadioGroupItem value="balanced" id="balanced"/>
                            <Label htmlFor="balanced" className="font-normal">
                              Ordem
                            </Label>
                          </div>
                          <div className="flex items-center space-x-3 space-y-0">
                              <RadioGroupItem value="random" id="random"/>
                            <Label htmlFor="random" className="font-normal">
                              Aleatório (Sorteio)
                            </Label>
                          </div>
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
                        <Label>Disputa de 3º Lugar</Label>
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
                       <CardContent>
                          <Bracket playoffs={playoffs} />
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
