

"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2 } from "lucide-react"

import { getTournaments, saveTournament, generateGroupsAction } from "@/app/actions"
import type { TournamentData, PlayoffMatch, GroupWithScores, TournamentFormValues, Team, GenerateTournamentGroupsOutput, TournamentsState, CategoryData, PlayoffBracketSet, PlayoffBracket, GlobalSettings } from "@/lib/types"
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
import { Switch } from "./ui/switch"
import { Label } from "@/components/ui/label"
import { Separator } from "./ui/separator"

const teamToKey = (team?: Team) => {
    if (!team || !team.player1 || !team.player2) return '';
    return `${team.player1} e ${team.player2}`;
};

export function TournamentCreator() {
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false);
  const [tournaments, setTournaments] = useState<TournamentsState>({ _globalSettings: { startTime: "08:00", estimatedMatchDuration: 20, courts: [{ name: 'Quadra 1', slots: [{startTime: "09:00", endTime: "18:00"}] }] }})
  const [isLoaded, setIsLoaded] = useState(false);
  const { toast } = useToast()

  // Load initial data from the "DB"
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const savedTournaments = await getTournaments();
        setTournaments(savedTournaments);
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
  }, [toast]);

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
      tournamentType: "groups",
      numberOfTeams: 16,
      numberOfGroups: 4,
      teamsPerGroupToAdvance: 2,
      teams: `Peri e Gularte
Fabinho e Bergallo
Caslu e Leo
Alex e Lage
Felipe M. e Rapha B.
Rodrigo e Paulinho
Carelli e Hantaro
Neves e Caze
Gustavo M. e Marcus
Gabe e Yan
Brenner e Py
Carril  e Leandro 
Russo e Maki
James e Fabio
Sartoratto e Poppe
Olavo e Dudu`,
      groupFormationStrategy: "order",
      includeThirdPlace: true,
    },
  })

  const tournamentType = form.watch("tournamentType");
  const teamsInput = form.watch("teams");

  useEffect(() => {
    if (tournamentType === 'doubleElimination') {
      form.setValue('includeThirdPlace', true, { shouldValidate: true });
    }
  }, [form, tournamentType]);

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
        matches: group.matches.map(match => ({ ...match, score1: undefined, score2: undefined, time: '', court: '' })),
        standings: sortedStandings
      }
    })
  }

  const getTeamPlaceholder = useCallback((groupIndex: number, position: number) => {
    const groupLetter = String.fromCharCode(65 + groupIndex);
    return `${position}º do Grupo ${groupLetter}`;
  }, []);

  const countMatchesInBracket = useCallback((bracket: PlayoffBracket | undefined): number => {
    if (!bracket) return 0;
    return Object.values(bracket).reduce((total, round) => total + round.length, 0);
  }, []);

  const initializeDoubleEliminationBracket = useCallback((values: TournamentFormValues): PlayoffBracketSet | null => {
    const allTeamsList = values.teams
        .split("\n")
        .map(t => t.trim())
        .filter(Boolean)
        .map(ts => ({ player1: ts.split(/\s+e\s+/i)[0].trim(), player2: ts.split(/\s+e\s+/i)[1].trim() }));

    const numTeams = allTeamsList.length;
    if (numTeams < 2) return null;

    let teams = [...allTeamsList];
    if (values.groupFormationStrategy === 'random') {
        teams.sort(() => Math.random() - 0.5);
    }
    
    const bracketSize = Math.pow(2, Math.ceil(Math.log2(numTeams)));
    const byes = bracketSize - numTeams;

    const teamsWithBye = values.groupFormationStrategy === 'order'
        ? teams.slice(0, byes)
        : teams.slice(numTeams - byes); 

    const teamsInFirstRound = teams.filter(team => !teamsWithBye.some(byeTeam => teamToKey(byeTeam) === teamToKey(team)));
    
    const upperBracket: PlayoffBracket = {};
    let wbRoundCounter = 1;

    let round1Matches: PlayoffMatch[] = [];
    if (teamsInFirstRound.length > 0) {
        const round1Name = `Upper Rodada ${wbRoundCounter}`;
        for (let i = 0; i < teamsInFirstRound.length / 2; i++) {
            round1Matches.push({
                id: `U-R${wbRoundCounter}-${i + 1}`, name: `${round1Name} Jogo ${i + 1}`,
                team1: teamsInFirstRound[i],
                team2: teamsInFirstRound[teamsInFirstRound.length - 1 - i],
                team1Placeholder: teamToKey(teamsInFirstRound[i]),
                team2Placeholder: teamToKey(teamsInFirstRound[teamsInFirstRound.length - 1 - i]),
                time: '', roundOrder: 100 - wbRoundCounter,
            });
        }
        upperBracket[round1Name] = round1Matches;
    }

    let currentUpperRoundTeamsPlaceholders: string[] = teamsWithBye.map(t => teamToKey(t)!);
    if(round1Matches.length > 0) {
      currentUpperRoundTeamsPlaceholders.push(...round1Matches.map(m => `Vencedor ${m.id}`));
    }
    
    currentUpperRoundTeamsPlaceholders.sort();

    wbRoundCounter++;

    while (currentUpperRoundTeamsPlaceholders.length > 1) {
        const roundName = `Upper Rodada ${wbRoundCounter}`;
        const nextRoundMatches: PlayoffMatch[] = [];
        
        for (let i = 0; i < currentUpperRoundTeamsPlaceholders.length / 2; i++) {
            const team1Placeholder = currentUpperRoundTeamsPlaceholders[i];
            const team2Placeholder = currentUpperRoundTeamsPlaceholders[currentUpperRoundTeamsPlaceholders.length - 1 - i];
            
            nextRoundMatches.push({
                id: `U-R${wbRoundCounter}-${i + 1}`, name: `${roundName} Jogo ${i + 1}`,
                team1Placeholder: team1Placeholder,
                team2Placeholder: team2Placeholder,
                time: '', roundOrder: 100 - wbRoundCounter,
            });
        }
        upperBracket[roundName] = nextRoundMatches;
        currentUpperRoundTeamsPlaceholders = nextRoundMatches.map(m => `Vencedor ${m.id}`);
        wbRoundCounter++;
    }

    const lowerBracket: PlayoffBracket = {};
    const wbLosersByRound: { [key: number]: (string | null)[] } = {};
    
    for (let r = 1; r < wbRoundCounter; r++) {
        const roundName = `Upper Rodada ${r}`;
        const wbMatches = upperBracket[roundName] || [];
        wbLosersByRound[r] = wbMatches.map(m => `Perdedor ${m.id}`);
    }

    let lbRoundCounter = 1;
    let lbSurvivors: (string | null)[] = [];

    const r1Losers = wbLosersByRound[1] || [];
    
    if (r1Losers.length > 0) {
      const lbRound1Name = `Lower Rodada ${lbRoundCounter}`;
      const lbRound1Matches: PlayoffMatch[] = [];
      for (let i = 0; i < r1Losers.length / 2; i++) {
        lbRound1Matches.push({
            id: `L-R${lbRoundCounter}-${i+1}`, name: `${lbRound1Name} Jogo ${i+1}`,
            team1Placeholder: r1Losers[i]!,
            team2Placeholder: r1Losers[r1Losers.length - 1 - i]!,
            time: '', roundOrder: -(lbRoundCounter * 2),
        });
      }
      if(lbRound1Matches.length > 0) lowerBracket[lbRound1Name] = lbRound1Matches;
      lbSurvivors = lbRound1Matches.map(m => `Vencedor ${m.id}`);
      lbRoundCounter++;
    }

    for (let wbR = 2; wbR < wbRoundCounter; wbR++) {
        let contenders = [...lbSurvivors, ...(wbLosersByRound[wbR] || [])].filter(Boolean) as string[];
        
        const dropDownRoundName = `Lower Rodada ${lbRoundCounter}`;
        const dropDownRoundMatches: PlayoffMatch[] = [];
        if (contenders.length > 0) {
            for (let i = 0; i < contenders.length / 2; i++) {
                dropDownRoundMatches.push({
                    id: `L-R${lbRoundCounter}-${i + 1}`, name: `${dropDownRoundName} Jogo ${i + 1}`,
                    team1Placeholder: contenders[i]!,
                    team2Placeholder: contenders[contenders.length - 1 - i]!,
                    time: '', roundOrder: -(lbRoundCounter * 2),
                });
            }
        }
        if (dropDownRoundMatches.length > 0) {
            lowerBracket[dropDownRoundName] = dropDownRoundMatches;
        }

        let currentSurvivors = dropDownRoundMatches.map(m => `Vencedor ${m.id}`);
        lbRoundCounter++;

        if (currentSurvivors.length > 1) {
            const internalRoundName = `Lower Rodada ${lbRoundCounter}`;
            const internalRoundMatches: PlayoffMatch[] = [];
             for (let i = 0; i < currentSurvivors.length / 2; i++) {
                internalRoundMatches.push({
                    id: `L-R${lbRoundCounter}-${i + 1}`, name: `${internalRoundName} Jogo ${i + 1}`,
                    team1Placeholder: currentSurvivors[i]!,
                    team2Placeholder: currentSurvivors[currentSurvivors.length - 1 - i]!,
                    time: '', roundOrder: -(lbRoundCounter * 2 - 1),
                });
            }
             if (internalRoundMatches.length > 0) {
                lowerBracket[internalRoundName] = internalRoundMatches;
            }
            lbSurvivors = internalRoundMatches.map(m => `Vencedor ${m.id}`);
        } else {
           lbSurvivors = currentSurvivors;
        }

        lbRoundCounter++;
    }
    
    const wbFinalist = `Vencedor ${upperBracket[`Upper Rodada ${wbRoundCounter-1}`]?.[0]?.id}`;
    const lbFinalist = lbSurvivors[0];

    const finalPlayoffs: PlayoffBracket = {};
    const grandFinalName = "Grande Final";
    finalPlayoffs[grandFinalName] = [
        { id: 'GF-1', name: grandFinalName, team1Placeholder: wbFinalist, team2Placeholder: lbFinalist!, time: '', roundOrder: 101 }
    ];

    if (values.includeThirdPlace) {
       const wbFinalRoundName = `Upper Rodada ${wbRoundCounter - 1}`;
       const lbFinalRoundName = `Lower Rodada ${lbRoundCounter - 2}`;
       
       const wbSemiFinalistLoser = `Perdedor ${upperBracket[wbFinalRoundName]?.[0]?.id}`;
       const lbSemiFinalistLoser = `Perdedor ${lowerBracket[lbFinalRoundName]?.[0]?.id}`;

        if (wbSemiFinalistLoser && lbSemiFinalistLoser) {
            const thirdPlaceName = "Disputa de 3º Lugar";
            finalPlayoffs[thirdPlaceName] = [
                { id: '3P-1', name: thirdPlaceName, team1Placeholder: wbSemiFinalistLoser, team2Placeholder: lbSemiFinalistLoser, time: '', roundOrder: 0 }
            ];
        }
    }

    return { upper: upperBracket, lower: lowerBracket, playoffs: finalPlayoffs };
}, []);

  const initializePlayoffs = useCallback((values: TournamentFormValues, aiResult?: GenerateTournamentGroupsOutput): PlayoffBracketSet | null => {
        if (values.tournamentType === 'doubleElimination') {
          return initializeDoubleEliminationBracket(values);
        }
        if (values.tournamentType === 'singleElimination') {
            if (!aiResult?.playoffMatches) return null;

            const totalQualifiers = values.numberOfTeams;
            if (totalQualifiers < 2) return null;
            
            let bracket: PlayoffBracket = {};
            
            const numTeams = totalQualifiers;
            const isPowerOfTwo = numTeams > 1 && (numTeams & (numTeams - 1)) === 0;
            if (!isPowerOfTwo) {
                 toast({
                    variant: "destructive",
                    title: "Número de Duplas Inválido",
                    description: "Para mata-mata simples, o número de duplas deve ser uma potência de 2 (4, 8, 16...).",
                });
                return null;
            }
            
            let teamsInRound = totalQualifiers;
            let roundOrder = Math.log2(teamsInRound);
            
            let currentRoundMatches: PlayoffMatch[] = aiResult.playoffMatches.map((match, i) => ({
                id: `R1-Jogo${i + 1}`,
                name: `Rodada 1 Jogo ${i + 1}`,
                team1: match.team1,
                team2: match.team2,
                team1Placeholder: teamToKey(match.team1),
                team2Placeholder: teamToKey(match.team2),
                time: '',
                roundOrder: roundOrder
            }));

            bracket[`Rodada 1`] = currentRoundMatches;
            
            teamsInRound /= 2;
            roundOrder--;
            let upperRound = 2;

            while (teamsInRound >= 2) { 
                const roundNameKey = teamsInRound === 4 ? 'Semifinal' : (teamsInRound === 2 ? 'Final' : `Quartas de Final`);
                const roundName = teamsInRound === 4 ? 'Semifinal' : (teamsInRound === 2 ? 'Final' : `Quartas de Final`);
                const nextRoundPlaceholders = [];
                for (let i = 0; i < currentRoundMatches.length; i++) {
                     nextRoundPlaceholders.push(`Vencedor ${currentRoundMatches[i].id}`);
                }
                
                const nextRoundMatches: PlayoffMatch[] = [];
                for (let i = 0; i < nextRoundPlaceholders.length / 2; i++) {
                    const matchName = `${roundName} ${i + 1}`;
                    nextRoundMatches.push({
                        id: `${roundNameKey.replace(/\s/g, '')}-R${upperRound}-Jogo${i + 1}`,
                        name: matchName,
                        team1Placeholder: nextRoundPlaceholders[i*2],
                        team2Placeholder: nextRoundPlaceholders[i*2 + 1],
                        time: '',
                        roundOrder
                    });
                }

                currentRoundMatches = nextRoundMatches;
                bracket[roundNameKey] = currentRoundMatches;
                
                if(teamsInRound === 2) break;

                teamsInRound /= 2;
                roundOrder--;
                upperRound++;
            }
            
            if (values.includeThirdPlace && bracket['Semifinal']) {
                const semiFinalLosers = bracket['Semifinal'].map(m => `Perdedor ${m.id}`);
                bracket['Disputa de 3º Lugar'] = [
                    { id: 'terceiro-lugar-1', name: 'Disputa de 3º Lugar', team1Placeholder: semiFinalLosers[0], team2Placeholder: semiFinalLosers[1], time: '', roundOrder: 0 }
                ];
            }
            
            return bracket;

        } else if (values.tournamentType === 'groups') {
            const { numberOfGroups, teamsPerGroupToAdvance, includeThirdPlace } = values;
            const totalQualifiers = numberOfGroups! * teamsPerGroupToAdvance!;

            if (totalQualifiers < 2 || (totalQualifiers & (totalQualifiers - 1)) !== 0) {
                return null
            }

            let bracket: PlayoffBracket = {};
            const teamPlaceholders = [];
            for (let i = 0; i < numberOfGroups!; i++) {
                for (let j = 1; j <= teamsPerGroupToAdvance!; j++) {
                    teamPlaceholders.push(getTeamPlaceholder(i, j));
                }
            }

            const firstRoundMatchups = [];
            const half = teamPlaceholders.length / 2;
            for (let i = 0; i < half; i++) {
                firstRoundMatchups.push({
                    team1Placeholder: teamPlaceholders[i],
                    team2Placeholder: teamPlaceholders[teamPlaceholders.length - 1 - i],
                });
            }

            let teamsInRound = totalQualifiers;
            let roundOrder = Math.log2(teamsInRound);
            let currentMatchups = firstRoundMatchups;
            let roundCounter = 1;

            while (teamsInRound >= 2) {
                const roundName = teamsInRound === 2 ? 'Final' : (teamsInRound === 4 ? 'Semifinal' : (teamsInRound === 8 ? 'Quartas de Final' : `Rodada ${roundCounter}`));
                bracket[roundName] = [];
                const nextRoundPlaceholders = [];

                for (let i = 0; i < currentMatchups.length; i++) {
                    const match = currentMatchups[i];
                    const matchId = `${roundName.replace(/\s/g, '')}-${i + 1}`;
                     bracket[roundName].push({
                        id: matchId,
                        name: `${roundName} ${i + 1}`,
                        team1Placeholder: match.team1Placeholder,
                        team2Placeholder: match.team2Placeholder,
                        time: '',
                        roundOrder
                    });
                    nextRoundPlaceholders.push(`Vencedor ${matchId}`);
                }

                if(nextRoundPlaceholders.length < 2) break;

                const nextMatchups = [];
                for(let i=0; i < nextRoundPlaceholders.length / 2; i++) {
                    nextMatchups.push({
                        team1Placeholder: nextRoundPlaceholders[i],
                        team2Placeholder: nextRoundPlaceholders[nextRoundPlaceholders.length - 1 - i],
                    });
                }
                currentMatchups = nextMatchups;
                teamsInRound /= 2;
                roundOrder--;
                roundCounter++;
            }
            
            if (includeThirdPlace && bracket['Semifinal']) {
                const semiFinalLosers = bracket['Semifinal'].map(m => `Perdedor ${m.id}`);
                bracket['Disputa de 3º Lugar'] = [
                    { id: 'terceiro-lugar-1', name: 'Disputa de 3º Lugar', team1Placeholder: semiFinalLosers[0], team2Placeholder: semiFinalLosers[1], time: '', roundOrder: 0 }
                ];
            }

            return bracket;
        }
        return null;
    }, [getTeamPlaceholder, toast, initializeDoubleEliminationBracket]);
    
  async function processTournament(values: TournamentFormValues, isUpdate: boolean) {
    setIsLoading(true);
    const categoryName = values.category;

    if (!isUpdate && tournaments[categoryName]) {
        toast({
            variant: "destructive",
            title: "Categoria já existe",
            description: "Uma categoria com este nome já foi gerada. Escolha um nome diferente ou atualize a existente.",
        });
        setIsLoading(false);
        return;
    }
     if (isUpdate && !tournaments[categoryName]) {
        toast({
            variant: "destructive",
            title: "Categoria não encontrada",
            description: "Não foi encontrada uma categoria com este nome para atualizar.",
        });
        setIsLoading(false);
        return;
    }
    
    const calculateTotalMatches = (categoryData: CategoryData) => {
        let count = 0;
        const { formValues, tournamentData, playoffs } = categoryData;
        
        if (formValues.tournamentType === 'groups' && tournamentData) {
            count += tournamentData.groups.reduce((acc, group) => acc + group.matches.length, 0);
        }

        if (playoffs) {
             if (formValues.tournamentType === 'doubleElimination' && ('upper' in playoffs || 'lower' in playoffs || 'playoffs' in playoffs)) {
                const bracketSet = playoffs as PlayoffBracketSet;
                count += countMatchesInBracket(bracketSet.upper);
                count += countMatchesInBracket(bracketSet.lower);
                count += countMatchesInBracket(bracketSet.playoffs);
            } else {
                count += countMatchesInBracket(playoffs as PlayoffBracket);
            }
        }
        return count;
    };

    let newCategoryData: CategoryData = {
        tournamentData: null,
        playoffs: null,
        formValues: values,
    };

    if (values.tournamentType === 'doubleElimination') {
        const finalPlayoffs = initializeDoubleEliminationBracket(values);
        
        newCategoryData.playoffs = finalPlayoffs;
    } else {
        const teamsArray: Team[] = values.teams
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean)
          .map((teamString) => {
            const players = teamString.split(/\s+e\s+/i).map((p) => p.trim())
            return { player1: players[0] || "", player2: players[1] || "" }
          })

        const result = await generateGroupsAction({
          numberOfTeams: values.numberOfTeams,
          numberOfGroups: values.numberOfGroups,
          groupFormationStrategy: values.groupFormationStrategy,
          teams: teamsArray,
          category: values.category,
          tournamentType: values.tournamentType,
        })

        if (!result.success || !result.data) {
          toast({
            variant: "destructive",
            title: "Erro ao Gerar",
            description: result.error || "Ocorreu um erro inesperado.",
          })
          setIsLoading(false);
          return;
        }

        if (values.tournamentType === 'groups') {
            newCategoryData.tournamentData = { groups: initializeStandings(result.data.groups) };
            newCategoryData.playoffs = initializePlayoffs(values, result.data);
        } else if (values.tournamentType === 'singleElimination') {
            newCategoryData.playoffs = initializePlayoffs(values, result.data);
        }
    }
    
    newCategoryData.totalMatches = calculateTotalMatches(newCategoryData);

    setTournaments(prev => ({ ...prev, [categoryName]: newCategoryData }));
    await saveData(categoryName, newCategoryData);
    
    toast({
      title: isUpdate ? "Categoria Atualizada!" : "Categoria Gerada!",
      description: `A categoria "${categoryName}" foi ${isUpdate ? 'atualizada' : 'criada'} com sucesso.`,
    });
    
    setIsLoading(false);
  }

  const handleCreate = async (values: TournamentFormValues) => {
    processTournament(values, false);
  }

  const handleUpdate = async (values: TournamentFormValues) => {
    processTournament(values, true);
  }


  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Formulário da Categoria</CardTitle>
        <CardDescription>
          Insira os detalhes para a geração de uma nova categoria.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-6">
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
            
            <FormField
                control={form.control}
                name="tournamentType"
                render={({ field }) => (
                    <FormItem className="space-y-3">
                    <FormLabel>Tipo de Torneio</FormLabel>
                    <FormControl>
                        <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        value={field.value}
                        className="flex flex-col space-y-1"
                        >
                        <div className="flex items-center space-x-3 space-y-0">
                            <RadioGroupItem value="groups" id="groups"/>
                            <Label htmlFor="groups" className="font-normal">
                            Fase de Grupos + Mata-Mata
                            </Label>
                        </div>
                        <div className="flex items-center space-x-3 space-y-0">
                            <RadioGroupItem value="singleElimination" id="singleElimination"/>
                            <Label htmlFor="singleElimination" className="font-normal">
                            Mata-Mata Simples
                            </Label>
                        </div>
                         <div className="flex items-center space-x-3 space-y-0">
                            <RadioGroupItem value="doubleElimination" id="doubleElimination"/>
                            <Label htmlFor="doubleElimination" className="font-normal">
                            Dupla Eliminação
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

            {tournamentType === "groups" && (
                <div className="grid grid-cols-2 gap-4">
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
                </div>
            )}
           
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
                  <FormLabel>Estratégia de Sorteio</FormLabel>
                   <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      defaultValue={field.value}
                      className="flex flex-col space-y-1"
                    >
                      <div className="flex items-center space-x-3 space-y-0">
                          <RadioGroupItem value="order" id="order"/>
                        <Label htmlFor="order" className="font-normal">
                          Ordem (Cabeças de chave)
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
                      disabled={tournamentType === 'doubleElimination'}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex flex-col gap-4">
                <Button onClick={form.handleSubmit(handleCreate)} disabled={isLoading || isSaving} className="w-full">
                  {(isLoading || isSaving) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isSaving ? 'Salvando...' : isLoading ? 'Gerando...' : 'Gerar Nova Categoria'}
                </Button>
                
                <Separator />

                <Button onClick={form.handleSubmit(handleUpdate)} variant="secondary" disabled={isLoading || isSaving} className="w-full">
                    {(isLoading || isSaving) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Atualizar Categoria Existente
                </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
