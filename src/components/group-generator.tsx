
"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Trophy, ExternalLink, Clock } from "lucide-react"

import { generateGroupsAction, getTournaments, saveTournament } from "@/app/actions"
import type { TournamentData, TeamStanding, PlayoffMatch, GroupWithScores, TournamentFormValues, Team, GenerateTournamentGroupsOutput, TournamentsState, CategoryData } from "@/lib/types"
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
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import Link from "next/link"


type PlayoffBracket = {
  [round: string]: PlayoffMatch[];
};

const roundNames: { [key: number]: string } = {
  2: 'Final',
  4: 'Semifinal',
  8: 'Quartas de Final',
  16: 'Oitavas de Final'
};

export function GroupGenerator() {
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false);
  const [tournaments, setTournaments] = useState<TournamentsState>({})
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);


  const { toast } = useToast()

  // Load initial data from the "DB"
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const savedTournaments = await getTournaments();
        setTournaments(savedTournaments);
        const categories = Object.keys(savedTournaments);
        if (categories.length > 0 && !activeTab) {
          setActiveTab(categories[0]);
        }
      } catch (error) {
        console.error("Failed to load tournaments from DB", error);
        toast({
          variant: "destructive",
          title: "Erro ao carregar dados",
          description: "Não foi possível carregar os torneios salvos.",
        });
      } finally {
        setIsLoaded(true);
      }
    };
    fetchInitialData();
  }, [toast, activeTab]);

  const saveData = async (categoryName: string, data: CategoryData) => {
    setIsSaving(true);
    const result = await saveTournament(categoryName, data);
    if (!result.success) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: result.error || "Não foi possível salvar as alterações.",
      });
    }
    setIsSaving(false);
  };


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
  
  const activeCategoryData = activeTab ? tournaments[activeTab] : null;
  const activeTournamentData = activeCategoryData?.tournamentData;
  const activePlayoffs = activeCategoryData?.playoffs;
  const activeFormValues = activeCategoryData?.formValues;
  

  const teamToKey = (team: Team) => `${team.player1} e ${team.player2}`;

  const initializeStandings = (groups: GenerateTournamentGroupsOutput['groups']): GroupWithScores[] => {
    return groups.map(group => {
      const standings: Record<string, Omit<TeamStanding, 'points'>> = {}
      group.teams.forEach(team => {
        const teamKey = teamToKey(team)
        standings[teamKey] = { team, played: 0, wins: 0, setsWon: 0, setDifference: 0 }
      })
      const sortedStandings = Object.values(standings).sort((a, b) => a.team.player1.localeCompare(b.team.player1))
      return {
        ...group,
        matches: group.matches.map(match => ({ ...match, score1: undefined, score2: undefined, time: '' })),
        standings: sortedStandings
      }
    })
  }

  const getTeamPlaceholder = useCallback((groupIndex: number, position: number) => {
    const groupLetter = String.fromCharCode(65 + groupIndex);
    return `${position}º do Grupo ${groupLetter}`;
  }, []);

  const generatePlayoffPlaceholders = useCallback((totalQualifiers: number, numGroups: number, numAdvance: number): { [key: string]: string } => {
    const placeholders: { [key: string]: string } = {};
    const teamsToSeed = [];
    for (let i = 0; i < numGroups; i++) {
      for (let j = 1; j <= numAdvance; j++) {
        teamsToSeed.push(getTeamPlaceholder(i, j));
      }
    }
  
    for (let i = 0; i < totalQualifiers / 2; i++) {
      placeholders[teamsToSeed[i]] = teamsToSeed[i];
      placeholders[teamsToSeed[totalQualifiers - 1 - i]] = teamsToSeed[totalQualifiers - 1 - i];
    }
    return placeholders;
  }, [getTeamPlaceholder]);

  const initializePlayoffs = useCallback((values: TournamentFormValues): PlayoffBracket | null => {
    const { numberOfGroups, teamsPerGroupToAdvance, includeThirdPlace } = values;
    const totalQualifiers = numberOfGroups * teamsPerGroupToAdvance;

    if (totalQualifiers < 2 || (totalQualifiers & (totalQualifiers - 1)) !== 0) {
      return null
    }
  
    let bracket: PlayoffBracket = {};
    const placeholders = generatePlayoffPlaceholders(totalQualifiers, numberOfGroups, teamsPerGroupToAdvance);
    const teamPlaceholders = Object.keys(placeholders).sort((a, b) => {
      const aMatch = a.match(/(\d+)º do Grupo ([A-Z])/);
      const bMatch = b.match(/(\d+)º do Grupo ([A-Z])/);
      if (aMatch && bMatch) {
          const [, aPos, aGroup] = aMatch;
          const [, bPos, bGroup] = bMatch;
          if (aGroup < bGroup) return -1;
          if (aGroup > bGroup) return 1;
          return parseInt(aPos) - parseInt(bPos);
      }
      return 0;
    });
  
    let currentRoundTeams = [...teamPlaceholders];
    let teamsInRound = totalQualifiers;
  
    while (teamsInRound >= 2) {
        const roundName = roundNames[teamsInRound] || `Rodada de ${teamsInRound}`;
        bracket[roundName] = [];
        const nextRoundTeams = [];
        
        const roundMatches = [];
        const half = currentRoundTeams.length / 2;
        for (let i = 0; i < half; i++) {
            roundMatches.push({
                team1Placeholder: currentRoundTeams[i],
                team2Placeholder: currentRoundTeams[currentRoundTeams.length - 1 - i],
            });
        }
  
        for (let i = 0; i < roundMatches.length; i++) {
            const match = roundMatches[i];
            const roundNameSingle = roundName.endsWith('s') ? roundName.slice(0, -1) : roundName;
            const matchId = `${roundNameSingle.replace(/\s/g, '')}-${i + 1}`;
            bracket[roundName].push({
                id: matchId,
                name: `${roundNameSingle} ${i + 1}`,
                team1Placeholder: match.team1Placeholder,
                team2Placeholder: match.team2Placeholder,
                time: '',
            });
            nextRoundTeams.push(`Vencedor ${roundNameSingle} ${i + 1}`);
        }
  
        currentRoundTeams = nextRoundTeams;
        teamsInRound /= 2;
    }
  
    if (includeThirdPlace && bracket['Semifinal']) {
        const semiFinalLosers = bracket['Semifinal'].map(m => `Perdedor ${m.name}`);
        bracket['Disputa de 3º Lugar'] = [
            { id: 'terceiro-lugar-1', name: 'Disputa de 3º Lugar', team1Placeholder: semiFinalLosers[0], team2Placeholder: semiFinalLosers[1], time: '' }
        ];
    }
  
    return bracket;
  }, [generatePlayoffPlaceholders]);


  const updatePlayoffs = useCallback(() => {
    if (!activeTab || !activeCategoryData) return;
  
    const { tournamentData, playoffs, formValues } = activeCategoryData;
    if (!tournamentData || !playoffs) return;
  
    const qualifiedTeams: { [placeholder: string]: Team } = {};
  
    tournamentData.groups.forEach((group, groupIndex) => {
      const allMatchesInGroupPlayed = group.matches.every(
        (m) => m.score1 !== undefined && m.score2 !== undefined
      );
  
      if (allMatchesInGroupPlayed) {
        group.standings.slice(0, formValues.teamsPerGroupToAdvance).forEach((standing, standingIndex) => {
          const placeholder = getTeamPlaceholder(groupIndex, standingIndex + 1);
          qualifiedTeams[placeholder] = standing.team;
        });
      }
    });
  
    const newPlayoffs = JSON.parse(JSON.stringify(playoffs)) as PlayoffBracket;
    const roundOrder = Object.keys(roundNames)
      .map(Number)
      .sort((a,b) => b-a)
      .map(key => roundNames[key])
      .filter(roundName => newPlayoffs[roundName]);
  
    if(newPlayoffs['Disputa de 3º Lugar']) {
      const finalIndex = roundOrder.indexOf('Final');
      if (finalIndex !== -1) {
          roundOrder.splice(finalIndex + 1, 0, 'Disputa de 3º Lugar');
      } else {
          roundOrder.push('Disputa de 3º Lugar');
      }
    }
  
    const winners: { [matchName: string]: Team | undefined } = {};
    const losers: { [matchName: string]: Team | undefined } = {};
  
    roundOrder.forEach(roundName => {
      newPlayoffs[roundName]?.forEach(match => {
        if (!match.team1 && match.team1Placeholder) {
          const placeholder = match.team1Placeholder;
          if (placeholder.startsWith('Vencedor ')) {
            const winnerMatchName = placeholder.replace('Vencedor ', '').replace(/(\d+)$/, ' $1');
            match.team1 = winners[winnerMatchName];
          } else if (placeholder.startsWith('Perdedor ')) {
            const loserMatchName = placeholder.replace('Perdedor ', '').replace(/(\d+)$/, ' $1');
            match.team1 = losers[loserMatchName];
          } else {
            match.team1 = qualifiedTeams[placeholder];
          }
        }
        if (!match.team2 && match.team2Placeholder) {
          const placeholder = match.team2Placeholder;
          if (placeholder.startsWith('Vencedor ')) {
            const winnerMatchName = placeholder.replace('Vencedor ', '').replace(/(\d+)$/, ' $1');
            match.team2 = winners[winnerMatchName];
          } else if (placeholder.startsWith('Perdedor ')) {
            const loserMatchName = placeholder.replace('Perdedor ', '').replace(/(\d+)$/, ' $1');
            match.team2 = losers[loserMatchName];
          } else {
            match.team2 = qualifiedTeams[placeholder];
          }
        }
  
        if (match.team1 && match.team2 && typeof match.score1 === 'number' && typeof match.score2 === 'number') {
          if (match.score1 > match.score2) {
            winners[match.name] = match.team1;
            losers[match.name] = match.team2;
          } else {
            winners[match.name] = match.team2;
            losers[match.name] = match.team1;
          }
        }
      });
    });
  
    if (JSON.stringify(playoffs) !== JSON.stringify(newPlayoffs)) {
      const updatedCategoryData = {
        ...activeCategoryData,
        playoffs: newPlayoffs,
      };
      setTournaments(prev => ({
        ...prev,
        [activeTab]: updatedCategoryData,
      }))
      saveData(activeTab, updatedCategoryData);
    }
  
  }, [activeTab, activeCategoryData, getTeamPlaceholder]);


  async function onSubmit(values: TournamentFormValues) {
    setIsLoading(true);
    const categoryName = values.category;

    if (tournaments[categoryName]) {
        toast({
            variant: "destructive",
            title: "Categoria já existe",
            description: "Uma categoria com este nome já foi gerada. Escolha um nome diferente.",
        });
        setIsLoading(false);
        return;
    }
    
    const newCategoryData: CategoryData = {
        tournamentData: null,
        playoffs: null,
        formValues: values,
    };

    const tempTournaments = { ...tournaments, [categoryName]: newCategoryData };
    setTournaments(tempTournaments);
    setActiveTab(categoryName);

    const teamsArray: Team[] = values.teams
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean)
      .map((teamString) => {
        const players = teamString.split(" e ").map((p) => p.trim())
        return { player1: players[0] || "", player2: players[1] || "" }
      })

    const result = await generateGroupsAction({
      numberOfTeams: values.numberOfTeams,
      numberOfGroups: values.numberOfGroups,
      groupFormationStrategy: values.groupFormationStrategy,
      teams: teamsArray,
      category: values.category,
    })

    if (result.success && result.data) {
      const groupsWithInitialStandings = initializeStandings(result.data.groups);
      const initialPlayoffs = initializePlayoffs(values);
      const finalCategoryData: CategoryData = {
          formValues: values,
          tournamentData: { groups: groupsWithInitialStandings },
          playoffs: initialPlayoffs,
      };

      setTournaments(prev => ({ ...prev, [categoryName]: finalCategoryData }));
      await saveData(categoryName, finalCategoryData);
      
      toast({
        title: "Categoria Gerada!",
        description: `A categoria "${categoryName}" foi criada com sucesso.`,
      })
    } else {
      setTournaments(prev => {
        const newTournaments = {...prev};
        delete newTournaments[categoryName];
        return newTournaments;
      });
      const remainingKeys = Object.keys(tournaments).filter(k => k !== categoryName);
      if (remainingKeys.length > 0) {
        setActiveTab(remainingKeys[0]);
      } else {
        setActiveTab(null);
      }
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
        const teamKey = teamToKey(team);
        standings[teamKey] = { team, played: 0, wins: 0, setsWon: 0, setDifference: 0 }
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
        } else {
          standings[team2Key].wins++
        }

        standings[team1Key].setsWon += score1
        standings[team2Key].setsWon += score2
      })

      const sortedStandings = Object.values(standings).map(s => {
          const matchingGroup = currentTournamentData.groups.find(g => g.teams.some(t => teamToKey(t) === teamToKey(s.team)));
          let setsLost = 0;
          if (matchingGroup) {
              matchingGroup.matches.forEach(m => {
                  if(m.score1 === undefined || m.score2 === undefined) return;
                  if (teamToKey(m.team1) === teamToKey(s.team)) {
                      setsLost += m.score2;
                  }
                  if (teamToKey(m.team2) === teamToKey(s.team)) {
                      setsLost += m.score1;
                  }
              });
          }
          return {
            ...s,
            setDifference: s.setsWon - setsLost
          }
      }).sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins
        if (b.setDifference !== a.setDifference) return b.setDifference - a.setDifference
        return b.setsWon - a.setsWon
      })

      return { ...group, standings: sortedStandings }
    })

    return { groups: newGroups }
  }

  const handleGroupMatchChange = (groupIndex: number, matchIndex: number, field: 'score1' | 'score2' | 'time', value: string) => {
    if (!activeTab || !activeTournamentData) return;
    let newTournamentData = JSON.parse(JSON.stringify(activeTournamentData));
    
    if (field === 'time') {
      newTournamentData.groups[groupIndex].matches[matchIndex].time = value;
    } else {
      const score = value === '' ? undefined : parseInt(value, 10);
      newTournamentData.groups[groupIndex].matches[matchIndex][field] = isNaN(score!) ? undefined : score;
    }

    const updatedDataWithStandings = calculateStandings(newTournamentData);
    const updatedCategoryData = {
      ...activeCategoryData!,
      tournamentData: updatedDataWithStandings
    };

    setTournaments(prev => ({
        ...prev,
        [activeTab]: updatedCategoryData,
    }));

    saveData(activeTab, updatedCategoryData);
  }

  const handlePlayoffMatchChange = (roundName: string, matchIndex: number, field: 'score1' | 'score2' | 'time', value: string) => {
    if (!activeTab || !activePlayoffs) return;
    let newPlayoffs = JSON.parse(JSON.stringify(activePlayoffs));

    if (field === 'time') {
      newPlayoffs[roundName][matchIndex].time = value;
    } else {
      const score = value === '' ? undefined : parseInt(value, 10);
      newPlayoffs[roundName][matchIndex][field] = isNaN(score!) ? undefined : score;
    }
    
    const updatedCategoryData = {
        ...activeCategoryData!,
        playoffs: newPlayoffs
    };
    setTournaments(prev => ({
        ...prev,
        [activeTab]: updatedCategoryData,
    }));
    saveData(activeTab, updatedCategoryData);
  };

  useEffect(() => {
    updatePlayoffs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTournamentData, JSON.stringify(activePlayoffs)]);

  const PlayoffMatchCard = ({ match, roundName, matchIndex }: { match: PlayoffMatch, roundName: string, matchIndex: number }) => {
    const getWinner = (m: PlayoffMatch) => {
      if(m.score1 === undefined || m.score2 === undefined || m.score1 === m.score2) return null;
      return m.score1 > m.score2 ? m.team1 : m.team2;
    }
  
    const winnerTeam = getWinner(match);
    const winnerKey = winnerTeam ? teamToKey(winnerTeam) : null;
  
    const team1Key = match.team1 ? teamToKey(match.team1) : null;
    const team2Key = match.team2 ? teamToKey(match.team2) : null;
      
    const placeholder1 = match.team1Placeholder.replace(/Vencedor Semifinal-?(\d)/, 'Vencedor Semifinal $1').replace(/Perdedor Semifinal-?(\d)/, 'Perdedor Semifinal $1');
    const placeholder2 = match.team2Placeholder.replace(/Vencedor Semifinal-?(\d)/, 'Vencedor Semifinal $1').replace(/Perdedor Semifinal-?(\d)/, 'Perdedor Semifinal $1');
  
    const isFinalRound = roundName === 'Final' || roundName === 'Disputa de 3º Lugar';
    
    return (
      <div className="flex flex-col gap-2 w-full">
          {(!isFinalRound && roundName !== 'Quartas de Final') && <h4 className="text-sm font-semibold text-center text-muted-foreground whitespace-nowrap">{match.name}</h4> }
          <div className="relative">
            <div className={`p-2 rounded-md space-y-2 ${isFinalRound ? 'max-w-md' : 'max-w-sm'} w-full mx-auto`}>
                <div className={`flex items-center w-full p-2 rounded-md ${winnerKey && team1Key && winnerKey === team1Key ? 'bg-green-100 dark:bg-green-900/30' : 'bg-secondary/50'}`}>
                    <span className={`text-left truncate pr-2 text-sm ${isFinalRound ? 'w-full' : 'flex-1'}`}>{match.team1 ? teamToKey(match.team1) : placeholder1}</span>
                    <Input
                        type="number"
                        className="h-8 w-14 shrink-0 text-center"
                        value={match.score1 ?? ''}
                        onChange={(e) => handlePlayoffMatchChange(roundName, matchIndex, 'score1', e.target.value)}
                        disabled={!match.team1 || !match.team2}
                    />
                </div>
                <div className="text-muted-foreground text-xs text-center py-1">vs</div>
                <div className={`flex items-center w-full p-2 rounded-md ${winnerKey && team2Key && winnerKey === team2Key ? 'bg-green-100 dark:bg-green-900/30' : 'bg-secondary/50'}`}>
                    <span className={`text-left truncate pr-2 text-sm ${isFinalRound ? 'w-full' : 'flex-1'}`}>{match.team2 ? teamToKey(match.team2) : placeholder2}</span>
                    <Input
                        type="number"
                        className="h-8 w-14 shrink-0 text-center"
                        value={match.score2 ?? ''}
                        onChange={(e) => handlePlayoffMatchChange(roundName, matchIndex, 'score2', e.target.value)}
                        disabled={!match.team1 || !match.team2}
                    />
                </div>
            </div>
            <div className="absolute top-1/2 -translate-y-1/2 -right-4 flex items-center">
              <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
              <Input 
                type="text" 
                className="h-8 w-24 text-center" 
                placeholder="00:00"
                value={match.time ?? ''}
                onChange={(e) => handlePlayoffMatchChange(roundName, matchIndex, 'time', e.target.value)}
                disabled={!match.team1 && !match.team2}
              />
            </div>
          </div>
      </div>
  )};
  

  const Bracket = ({ playoffs }: { playoffs: PlayoffBracket }) => {
    const regularRounds = Object.keys(roundNames)
      .map(Number)
      .sort((a,b) => b-a)
      .map(key => roundNames[key])
      .filter(roundName => playoffs[roundName] && roundName !== 'Final');

    return (
      <div className="flex flex-col items-center w-full overflow-x-auto p-4 gap-8">
        {regularRounds.map(roundName => (
          <Card key={roundName} className="w-full max-w-xl">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-primary">{roundName}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-8 w-full">
              {playoffs[roundName].map((match, matchIndex) => (
                <PlayoffMatchCard 
                  key={match.id} 
                  match={match} 
                  roundName={roundName} 
                  matchIndex={matchIndex} 
                />
              ))}
            </CardContent>
          </Card>
        ))}

        {playoffs['Final'] && (
             <Card className="w-full max-w-xl">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-primary">Final</CardTitle>
                </CardHeader>
                <CardContent>
                    <PlayoffMatchCard 
                        match={playoffs['Final'][0]} 
                        roundName="Final" 
                        matchIndex={0} 
                    />
                </CardContent>
             </Card>
        )}
        {playoffs['Disputa de 3º Lugar'] && (
             <Card className="w-full max-w-xl">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-primary">Disputa de 3º Lugar</CardTitle>
                </CardHeader>
                <CardContent>
                    <PlayoffMatchCard 
                        match={playoffs['Disputa de 3º Lugar'][0]} 
                        roundName="Disputa de 3º Lugar" 
                        matchIndex={0}
                    />
                </CardContent>
             </Card>
        )}
      </div>
    );
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
  };

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }


  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Configurações do Torneio</CardTitle>
            <CardDescription>
              Insira os detalhes para a geração de uma nova categoria.
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
                      <FormLabel>Nome da Categoria</FormLabel>
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
                          rows={form.watch('numberOfTeams') > 0 ? form.watch('numberOfTeams') : 4}
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

                <Button type="submit" disabled={isLoading || isSaving} className="w-full">
                  {(isLoading || isSaving) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                   {isSaving ? 'Salvando...' : isLoading ? 'Gerando...' : 'Gerar Categoria'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          {Object.keys(tournaments).length > 0 && activeTab ? (
             <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
              <div className="flex items-center justify-between gap-4">
                <TabsList className="hidden sm:inline-flex">
                    {Object.keys(tournaments).map(cat => (
                        <TabsTrigger key={cat} value={cat}>{cat}</TabsTrigger>
                    ))}
                </TabsList>
                 <div className="flex items-center gap-2 w-full sm:w-auto justify-between">
                     <div className="w-48 sm:hidden">
                       <Select value={activeTab} onValueChange={handleTabChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecionar categoria..." />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.keys(tournaments).map(cat => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                     <Button variant="outline" size="sm" asChild>
                        <Link href={`/tournament/${encodeURIComponent(activeTab)}`} target="_blank">
                           Ver Página <ExternalLink className="ml-2 h-4 w-4" />
                        </Link>
                     </Button>
                 </div>
              </div>
              {Object.keys(tournaments).map(categoryName => (
                  <TabsContent key={categoryName} value={categoryName}>
                      <Card className="min-h-full mt-4">
                        <CardHeader>
                          <CardTitle>Grupos e Jogos - {categoryName}</CardTitle>
                          <CardDescription>
                            Visualize os grupos, preencha os resultados e gere os playoffs.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                           {isLoading && activeTab === categoryName && !tournaments[categoryName]?.tournamentData && (
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                              {[...Array(tournaments[categoryName]?.formValues.numberOfGroups || 0)].map((_, i) => (
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
                           {activeTournamentData && (
                            <div className="space-y-8">
                              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                {activeTournamentData.groups.map((group, groupIndex) => (
                                  <Card key={group.name} className="flex flex-col">
                                    <CardHeader>
                                      <CardTitle className="text-primary">{group.name}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="flex flex-1 flex-col space-y-4">

                                      {group.standings && activeFormValues && (
                                        <div>
                                          <h4 className="mb-2 font-semibold">Classificação</h4>
                                          <Table>
                                            <TableHeader>
                                              <TableRow>
                                                <TableHead className="p-2">Dupla</TableHead>
                                                <TableHead className="p-2 text-center">V</TableHead>
                                                <TableHead className="p-2 text-center">J</TableHead>
                                                <TableHead className="p-2 text-center">PP</TableHead>
                                                <TableHead className="p-2 text-center">SP</TableHead>
                                              </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                              {group.standings.map((standing, index) => (
                                                <TableRow key={teamToKey(standing.team)} className={index < activeFormValues.teamsPerGroupToAdvance ? "bg-green-100 dark:bg-green-900/30" : ""}>
                                                  <TableCell className="p-2 font-medium">{teamToKey(standing.team)}</TableCell>
                                                  <TableCell className="p-2 text-center">{standing.wins}</TableCell>
                                                  <TableCell className="p-2 text-center">{standing.played}</TableCell>
                                                  <TableCell className="p-2 text-center">{standing.setsWon}</TableCell>
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
                                        <div className="relative">
                                          <div className="absolute left-10 top-0 h-full w-px bg-border -z-10"></div>
                                          <div className="space-y-2">
                                            {group.matches.map((match, matchIndex) => (
                                              <div key={matchIndex} className="relative flex items-center gap-4">
                                                <div className="relative">
                                                  <div className="h-full w-px bg-border absolute left-1/2 -translate-x-1/2"></div>
                                                  <Input
                                                    type="text"
                                                    className="h-8 w-20 text-center z-10 relative bg-background"
                                                    placeholder="00:00"
                                                    value={match.time ?? ''}
                                                    onChange={(e) => handleGroupMatchChange(groupIndex, matchIndex, 'time', e.target.value)}
                                                  />
                                                </div>
                                                <div className="flex-1 flex items-center justify-between gap-2 rounded-md bg-secondary/50 p-2 text-sm">
                                                    <span className="flex-1 text-right truncate">{teamToKey(match.team1)}</span>
                                                    <div className="flex items-center gap-1">
                                                        <Input type="number" className="h-7 w-12 text-center" value={match.score1 ?? ''} onChange={(e) => handleGroupMatchChange(groupIndex, matchIndex, 'score1', e.target.value)} />
                                                        <span className="text-muted-foreground">x</span>
                                                        <Input type="number" className="h-7 w-12 text-center" value={match.score2 ?? ''} onChange={(e) => handleGroupMatchChange(groupIndex, matchIndex, 'score2', e.target.value)} />
                                                    </div>
                                                    <span className="flex-1 text-left truncate">{teamToKey(match.team2)}</span>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    </CardContent>
                                  </Card>
                                ))}
                              </div>
                               {activePlayoffs && Object.keys(activePlayoffs).length > 0 && (
                                 <Card>
                                   <CardHeader>
                                     <CardTitle className="flex items-center"><Trophy className="mr-2 h-5 w-5 text-primary" />Playoffs - Mata-Mata</CardTitle>
                                     <CardDescription>Chaveamento gerado com base na classificação dos grupos.</CardDescription>
                                   </CardHeader>
                                   <CardContent>
                                      <Bracket playoffs={activePlayoffs} />
                                   </CardContent>
                                 </Card>
                              )}
                            </div>
                           )}
                        </CardContent>
                      </Card>
                  </TabsContent>
                ))}
            </Tabs>
          ) : (
            <Card className="min-h-full">
                 <CardContent>
                    <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg h-full min-h-[400px]">
                      <p className="text-muted-foreground">Gere uma categoria para visualizar os grupos e jogos aqui.</p>
                    </div>
                 </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

    