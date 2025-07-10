

"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Trophy, Clock, Trash2 } from "lucide-react"

import { generateGroupsAction, getTournaments, saveTournament, deleteTournament } from "@/app/actions"
import type { TournamentData, TeamStanding, PlayoffMatch, GroupWithScores, TournamentFormValues, Team, GenerateTournamentGroupsOutput, TournamentsState, CategoryData, PlayoffBracketSet, PlayoffBracket } from "@/lib/types"
import { formSchema } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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


const roundNames: { [key: number]: string } = {
  2: 'Final',
  4: 'Semifinal',
  8: 'Quartas de Final',
  16: 'Oitavas de Final'
};

const teamToKey = (team: Team) => `${team.player1} e ${team.player2}`;


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
     // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleDeleteCategory = async (categoryName: string) => {
    setIsLoading(true);
    const result = await deleteTournament(categoryName);
    if (result.success) {
      toast({
        title: "Categoria Excluída!",
        description: `A categoria "${categoryName}" foi excluída com sucesso.`,
      });
      // Update state
      const newTournaments = { ...tournaments };
      delete newTournaments[categoryName];
      setTournaments(newTournaments);

      const remainingCategories = Object.keys(newTournaments);
      if (remainingCategories.length > 0) {
        setActiveTab(remainingCategories[0]);
      } else {
        setActiveTab(null);
      }
    } else {
      toast({
        variant: "destructive",
        title: "Erro ao Excluir",
        description: result.error || "Não foi possível excluir a categoria.",
      });
    }
    setIsLoading(false);
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
      groupFormationStrategy: "balanced",
      includeThirdPlace: true,
    },
  })
  
  const tournamentType = form.watch("tournamentType");

  useEffect(() => {
    if (tournamentType === 'doubleElimination') {
      form.setValue('includeThirdPlace', true, { shouldValidate: true });
    }
  }, [tournamentType, form]);


  const activeCategoryData = activeTab ? tournaments[activeTab] : null;
  const activeTournamentData = activeCategoryData?.tournamentData;
  const activePlayoffs = activeCategoryData?.playoffs;
  const activeFormValues = activeCategoryData?.formValues;
  

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

  const initializePlayoffs = useCallback((values: TournamentFormValues, aiResult?: GenerateTournamentGroupsOutput): PlayoffBracketSet | null => {
        if (values.tournamentType === 'singleElimination' || (values.tournamentType === 'doubleElimination' && aiResult)) {
            if (!aiResult?.playoffMatches) return null;

            const totalQualifiers = values.numberOfTeams;
            if (totalQualifiers < 2) return null;
            
            if ((totalQualifiers & (totalQualifiers - 1)) !== 0) return null;

            let bracket: PlayoffBracket = {};
            
            let teamsInRound = totalQualifiers;
            let roundOrder = Math.log2(teamsInRound);
            let roundCounter = 1;

            const getRoundName = (teams: number, type: 'singleElimination' | 'doubleElimination') => {
                if (type === 'doubleElimination') {
                    return `Upper Rodada ${roundCounter}`;
                }
                return roundNames[teams] || `Rodada de ${teams}`;
            }
            
            const firstRoundName = getRoundName(teamsInRound, values.tournamentType);
            
            let currentRoundMatches: PlayoffMatch[] = aiResult.playoffMatches.map((match, i) => ({
                id: `R1-${i + 1}`,
                name: `${firstRoundName.replace(/s$/, "")} ${i + 1}`,
                team1: match.team1,
                team2: match.team2,
                team1Placeholder: teamToKey(match.team1),
                team2Placeholder: teamToKey(match.team2),
                time: '',
                roundOrder: roundOrder
            }));

            bracket[firstRoundName] = currentRoundMatches;
            
            teamsInRound /= 2;
            roundOrder--;
            roundCounter++;

            while (teamsInRound > 2) {
                const roundName = getRoundName(teamsInRound, values.tournamentType);
                bracket[roundName] = [];
                const nextRoundPlaceholders = [];
                
                for (let i = 0; i < currentRoundMatches.length; i++) {
                    const singleName = currentRoundMatches[i].name.replace(/ \d+$/, '');
                    nextRoundPlaceholders.push(`Vencedor ${singleName} ${i + 1}`);
                }

                const nextRoundMatches: PlayoffMatch[] = [];
                
                const half = nextRoundPlaceholders.length / 2;
                for (let i = 0; i < half; i++) {
                    const nextRoundNameSingle = roundName.replace(/s$/, "");
                    nextRoundMatches.push({
                        id: `${nextRoundNameSingle.replace(/\s/g, '')}-${i + 1}`,
                        name: `${nextRoundNameSingle} ${i + 1}`,
                        team1Placeholder: nextRoundPlaceholders[i],
                        team2Placeholder: nextRoundPlaceholders[nextRoundPlaceholders.length - 1 - i],
                        time: '',
                        roundOrder
                    });
                }

                currentRoundMatches = nextRoundMatches;
                bracket[roundName] = currentRoundMatches;
                
                if (roundName === 'Final') break;

                teamsInRound /= 2;
                roundOrder--;
                roundCounter++;
            }


            if (values.includeThirdPlace && bracket['Semifinal'] && values.tournamentType === 'singleElimination') {
                const semiFinalLosers = bracket['Semifinal'].map(m => `Perdedor ${m.name}`);
                bracket['Disputa de 3º Lugar'] = [
                    { id: 'terceiro-lugar-1', name: 'Disputa de 3º Lugar', team1Placeholder: semiFinalLosers[0], team2Placeholder: semiFinalLosers[1], time: '', roundOrder: 0 }
                ];
            }
            
            if(values.tournamentType === 'doubleElimination') {
                return { upper: bracket, lower: {}, playoffs: {} };
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

            let currentRoundTeams = [...teamPlaceholders];
            let teamsInRound = totalQualifiers;
            let roundOrder = Math.log2(teamsInRound);

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
                    const roundNameSingle = roundName === 'Semifinal' ? roundName : roundName.endsWith('s') ? roundName.slice(0, -1) : roundName;
                    const matchId = `${roundNameSingle.replace(/\s/g, '')}-${i + 1}`;
                    bracket[roundName].push({
                        id: matchId,
                        name: `${roundNameSingle} ${i + 1}`,
                        team1Placeholder: match.team1Placeholder,
                        team2Placeholder: match.team2Placeholder,
                        time: '',
                        roundOrder
                    });
                    nextRoundTeams.push(`Vencedor ${roundNameSingle} ${i + 1}`);
                }

                currentRoundTeams = nextRoundTeams;
                teamsInRound /= 2;
                roundOrder--;
            }

            if (includeThirdPlace && bracket['Semifinal']) {
                const semiFinalLosers = bracket['Semifinal'].map(m => `Perdedor ${m.name}`);
                bracket['Disputa de 3º Lugar'] = [
                    { id: 'terceiro-lugar-1', name: 'Disputa de 3º Lugar', team1Placeholder: semiFinalLosers[0], team2Placeholder: semiFinalLosers[1], time: '', roundOrder: 0 }
                ];
            }

            return bracket;
        }
        return null;
    }, [getTeamPlaceholder]);
    
  const initializeDoubleEliminationBracket = useCallback((values: TournamentFormValues, initialUpperBracket: PlayoffBracket): PlayoffBracketSet => {
    const lowerBracket: PlayoffBracket = {};
    const upperRounds = Object.keys(initialUpperBracket).sort((a, b) => (initialUpperBracket[b][0]?.roundOrder || 0) - (initialUpperBracket[a][0]?.roundOrder || 0));

    let lowerTeamsPool: string[] = [];
    let lowerRoundCounter = 1;

    // Process each round of upper bracket to generate lower bracket rounds
    for (let i = 0; i < upperRounds.length; i++) {
        const upperRoundName = upperRounds[i];
        const upperRoundMatches = initialUpperBracket[upperRoundName];

        if (!upperRoundMatches || upperRoundMatches.length === 0) continue;

        const losersFromUpper = upperRoundMatches.map(m => `Perdedor ${m.name}`);
        lowerTeamsPool.push(...losersFromUpper);

        const roundName = `Lower Rodada ${lowerRoundCounter}`;
        const nextRoundWinners: string[] = [];
        const currentRoundMatches: PlayoffMatch[] = [];

        // Pair up teams from the pool
        for (let j = 0; j < Math.floor(lowerTeamsPool.length / 2); j++) {
            const matchName = `${roundName} Jogo ${j + 1}`;
            currentRoundMatches.push({
                id: `L-R${lowerRoundCounter}-${j + 1}`,
                name: matchName,
                time: '',
                team1Placeholder: lowerTeamsPool[j * 2],
                team2Placeholder: lowerTeamsPool[j * 2 + 1],
                roundOrder: -lowerRoundCounter,
            });
            nextRoundWinners.push(`Vencedor ${matchName}`);
        }
        if (currentRoundMatches.length > 0) {
            lowerBracket[roundName] = currentRoundMatches;
        }

        lowerTeamsPool = nextRoundWinners;
        lowerRoundCounter++;
    }


    const playoffs: PlayoffBracket = {};
    const upperSemiFinals = initialUpperBracket[upperRounds[upperRounds.length - 1]];
    
    // Find the lower semifinals
    const lowerRoundKeys = Object.keys(lowerBracket).sort((a, b) => (lowerBracket[a][0]?.roundOrder || 0) - (lowerBracket[b][0]?.roundOrder || 0));
    const lowerSemiFinals = lowerBracket[lowerRoundKeys[0]];
    
    if (!upperSemiFinals || upperSemiFinals.length < 2 || !lowerSemiFinals || lowerSemiFinals.length < 2) {
        return { upper: initialUpperBracket, lower: lowerBracket, playoffs: {} };
    }

    const upperQualifiers = upperSemiFinals.map(m => `Vencedor ${m.name}`);
    const lowerQualifiers = lowerSemiFinals.map(m => `Vencedor ${m.name}`);

    playoffs['Semifinal'] = [
        { id: 'Final-Semifinal-1', name: 'Semifinal 1', team1Placeholder: upperQualifiers[0], team2Placeholder: lowerQualifiers[1], time: '', roundOrder: 2 },
        { id: 'Final-Semifinal-2', name: 'Semifinal 2', team1Placeholder: upperQualifiers[1], team2Placeholder: lowerQualifiers[0], time: '', roundOrder: 2 }
    ];

    playoffs['Final'] = [
        { id: 'Final-1', name: 'Final', team1Placeholder: 'Vencedor Semifinal 1', team2Placeholder: 'Vencedor Semifinal 2', time: '', roundOrder: 1 }
    ];

    if (values.includeThirdPlace) {
        playoffs['Disputa de 3º Lugar'] = [
            { id: 'terceiro-lugar-1', name: 'Disputa de 3º Lugar', team1Placeholder: 'Perdedor Semifinal 1', team2Placeholder: 'Perdedor Semifinal 2', time: '', roundOrder: 0 }
        ];
    }
    
    return { upper: initialUpperBracket, lower: lowerBracket, playoffs };
},[]);

  const updatePlayoffs = useCallback(() => {
    if (!activeTab || !activeCategoryData) return;

    const { playoffs, formValues, tournamentData } = activeCategoryData;
    if (!playoffs) return;

    const newPlayoffs = JSON.parse(JSON.stringify(playoffs)) as PlayoffBracketSet;
    const winners: { [matchName: string]: Team | undefined } = {};
    const losers: { [matchName: string]: Team | undefined } = {};

    const processBracket = (bracket: PlayoffBracket | PlayoffBracketSet | undefined) => {
        if (!bracket) return;

        if (formValues.tournamentType === 'doubleElimination' && ('upper' in bracket || 'lower' in bracket || 'playoffs' in bracket)) {
            const bracketSet = bracket as PlayoffBracketSet;
            processBracket(bracketSet.upper);
            processBracket(bracketSet.lower);
            processBracket(bracketSet.playoffs);
            return;
        }

        if (typeof bracket !== 'object' || bracket === null) {
          return;
        }
        
        const roundOrder = Object.keys(bracket).sort((a, b) => ((bracket as PlayoffBracket)[b]?.[0]?.roundOrder || 0) - ((bracket as PlayoffBracket)[a]?.[0]?.roundOrder || 0));
        
        roundOrder.forEach(roundName => {
            const roundMatches = (bracket as PlayoffBracket)[roundName];
            if (Array.isArray(roundMatches)) {
                roundMatches.forEach(match => {
                     if (match.team1 && match.team2 && typeof match.score1 === 'number' && typeof match.score2 === 'number') {
                        if (match.score1 > match.score2) {
                            winners[match.name] = match.team1;
                            losers[match.name] = match.team2;
                        } else if (match.score2 > match.score1) {
                            winners[match.name] = match.team2;
                            losers[match.name] = match.team1;
                        }
                    }
                });
            }
        });
    };
    
    const resolvePlaceholders = (bracket: PlayoffBracket | PlayoffBracketSet | undefined) => {
        if (!bracket) return;
        
         if (formValues.tournamentType === 'doubleElimination' && ('upper' in bracket || 'lower' in bracket || 'playoffs' in bracket)) {
            const bracketSet = bracket as PlayoffBracketSet;
            resolvePlaceholders(bracketSet.upper);
            resolvePlaceholders(bracketSet.lower);
            resolvePlaceholders(bracketSet.playoffs);
            return;
        }
        
        if (typeof bracket !== 'object' || bracket === null) return;

        const roundOrder = Object.keys(bracket).sort((a,b) => (((bracket as PlayoffBracket)[b]?.[0]?.roundOrder || 0) - ((bracket as PlayoffBracket)[a]?.[0]?.roundOrder || 0)));

        roundOrder.forEach(roundName => {
            const currentRound = (bracket as PlayoffBracket)[roundName];
             if (Array.isArray(currentRound)) {
                currentRound.forEach(match => {
                    // Resolve team 1
                    if (!match.team1 && match.team1Placeholder) {
                        const placeholder = match.team1Placeholder;
                        if (placeholder.startsWith('Vencedor ')) {
                            match.team1 = winners[placeholder.replace('Vencedor ', '')];
                        } else if (placeholder.startsWith('Perdedor ')) {
                            match.team1 = losers[placeholder.replace('Perdedor ', '')];
                        } else if (formValues.tournamentType === 'groups' && tournamentData) {
                             const groupsAreFinished = tournamentData.groups.every(g => 
                                g.standings.every(s => s.played === (g.teams.length - 1))
                            );
                            if(groupsAreFinished) {
                                const qualifiedTeams: { [p: string]: Team } = {};
                                tournamentData.groups.forEach((group, groupIndex) => {
                                    group.standings.slice(0, formValues.teamsPerGroupToAdvance).forEach((standing, standingIndex) => {
                                        qualifiedTeams[getTeamPlaceholder(groupIndex, standingIndex + 1)] = standing.team;
                                    });
                                });
                                match.team1 = qualifiedTeams[placeholder] || match.team1;
                            }
                        }
                    }
                    // Resolve team 2
                     if (!match.team2 && match.team2Placeholder) {
                        const placeholder = match.team2Placeholder;
                        if (placeholder.startsWith('Vencedor ')) {
                            match.team2 = winners[placeholder.replace('Vencedor ', '')];
                        } else if (placeholder.startsWith('Perdedor ')) {
                            match.team2 = losers[placeholder.replace('Perdedor ', '')];
                        } else if (formValues.tournamentType === 'groups' && tournamentData) {
                             const groupsAreFinished = tournamentData.groups.every(g => 
                                g.standings.every(s => s.played === (g.teams.length - 1))
                            );
                             if(groupsAreFinished) {
                                const qualifiedTeams: { [p: string]: Team } = {};
                                tournamentData.groups.forEach((group, groupIndex) => {
                                    group.standings.slice(0, formValues.teamsPerGroupToAdvance).forEach((standing, standingIndex) => {
                                        qualifiedTeams[getTeamPlaceholder(groupIndex, standingIndex + 1)] = standing.team;
                                    });
                                });
                                match.team2 = qualifiedTeams[placeholder] || match.team2;
                            }
                        }
                    }
                });
            }
        });
    };

    const passes = formValues.tournamentType === 'doubleElimination' ? 5 : 1;
    for (let i = 0; i < passes; i++) {
        processBracket(newPlayoffs);
        resolvePlaceholders(newPlayoffs);
    }
  
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

    if (result.success && result.data) {
      let finalPlayoffs: PlayoffBracketSet | null = null;
      let finalTournamentData: TournamentData | null = null;
      
      if (values.tournamentType === 'groups') {
          finalTournamentData = { groups: initializeStandings(result.data.groups) };
          finalPlayoffs = initializePlayoffs(values, result.data);
      } else if (values.tournamentType === 'singleElimination') {
          finalPlayoffs = initializePlayoffs(values, result.data);
      } else if (values.tournamentType === 'doubleElimination') {
          const upperBracketResult = initializePlayoffs(values, result.data);
          if(upperBracketResult && ('upper' in upperBracketResult)){
              finalPlayoffs = initializeDoubleEliminationBracket(values, upperBracketResult.upper as PlayoffBracket);
          }
      }

      const finalCategoryData: CategoryData = {
          formValues: values,
          tournamentData: finalTournamentData,
          playoffs: finalPlayoffs,
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
        } else if (score2 > score1) {
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

  const handlePlayoffMatchChange = (bracketKey: keyof PlayoffBracketSet | null, roundName: string, matchIndex: number, field: 'score1' | 'score2' | 'time', value: string) => {
    if (!activeTab || !activePlayoffs) return;
    let newPlayoffs = JSON.parse(JSON.stringify(activePlayoffs));

    let matchToUpdate;
    if (activeFormValues?.tournamentType === 'doubleElimination' && bracketKey && (newPlayoffs as PlayoffBracketSet)[bracketKey]) {
        matchToUpdate = (newPlayoffs as PlayoffBracketSet)[bracketKey]![roundName][matchIndex];
    } else {
        matchToUpdate = (newPlayoffs as PlayoffBracket)[roundName][matchIndex];
    }
    

    if (field === 'time') {
      matchToUpdate.time = value;
    } else {
      const score = value === '' ? undefined : parseInt(value, 10);
      matchToUpdate[field] = isNaN(score!) ? undefined : score;
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
  }, [JSON.stringify(tournaments), activeTab]);

  const PlayoffMatchCard = ({ match, roundName, matchIndex, bracketKey }: { match: PlayoffMatch, roundName: string, matchIndex: number, bracketKey: keyof PlayoffBracketSet | null }) => {
    const getWinner = (m: PlayoffMatch) => {
      if(m.score1 === undefined || m.score2 === undefined || m.score1 === m.score2) return null;
      return m.score1 > m.score2 ? m.team1 : m.team2;
    }
  
    const winnerTeam = getWinner(match);
    const winnerKey = winnerTeam ? teamToKey(winnerTeam) : null;
  
    const team1Key = match.team1 ? teamToKey(match.team1) : null;
    const team2Key = match.team2 ? teamToKey(match.team2) : null;
      
    const placeholder1 = (match.team1Placeholder || '').replace(/Vencedor Semifinal-?(\d)/, 'Vencedor Semifinal $1').replace(/Perdedor Semifinal-?(\d)/, 'Perdedor Semifinal $1');
    const placeholder2 = (match.team2Placeholder || '').replace(/Vencedor Semifinal-?(\d)/, 'Vencedor Semifinal $1').replace(/Perdedor Semifinal-?(\d)/, 'Perdedor Semifinal $1');
  
    const isFinalRound = roundName === 'Final' || roundName === 'Disputa de 3º Lugar' || roundName === 'Grande Final';
    
    return (
      <div className="flex items-center">
        {/* Timeline */}
        <div className="relative w-24 flex-shrink-0 h-full flex justify-center">
            <div className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
                <Input 
                    type="text" 
                    className="h-8 w-20 text-center bg-background" 
                    placeholder="00:00"
                    value={match.time ?? ''}
                    onChange={(e) => handlePlayoffMatchChange(bracketKey, roundName, matchIndex, 'time', e.target.value)}
                />
                <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
             <div className="w-px bg-border h-full" />
        </div>
  
        {/* Match Details */}
        <div className="flex-grow pl-4 py-4">
          <div className="flex flex-col gap-2 w-full">
              {!isFinalRound && <h4 className="text-sm font-semibold text-center text-muted-foreground whitespace-nowrap">{match.name}</h4> }
              <div className={`p-2 rounded-md space-y-2 ${isFinalRound ? 'max-w-md' : 'max-w-sm'} w-full mx-auto`}>
                  <div className={`flex items-center w-full p-2 rounded-md ${winnerKey && team1Key && winnerKey === team1Key ? 'bg-green-100 dark:bg-green-900/30' : 'bg-secondary/50'}`}>
                      <span className={`text-left truncate pr-2 text-sm ${isFinalRound ? 'w-full' : 'flex-1'}`}>{match.team1 ? teamToKey(match.team1) : placeholder1}</span>
                      <Input
                          type="number"
                          className="h-8 w-14 shrink-0 text-center"
                          value={match.score1 ?? ''}
                          onChange={(e) => handlePlayoffMatchChange(bracketKey, roundName, matchIndex, 'score1', e.target.value)}
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
                          onChange={(e) => handlePlayoffMatchChange(bracketKey, roundName, matchIndex, 'score2', e.target.value)}
                          disabled={!match.team1 || !match.team2}
                      />
                  </div>
              </div>
          </div>
        </div>
      </div>
  )};
  

  const Bracket = ({ playoffs, bracketKey }: { playoffs: PlayoffBracket, bracketKey?: keyof PlayoffBracketSet | null }) => {
    if (!playoffs || Object.keys(playoffs).length === 0) return null;

    const roundOrder = Object.keys(playoffs).sort((a,b) => (playoffs[b]?.[0]?.roundOrder || 0) - (playoffs[a]?.[0]?.roundOrder || 0));

    return (
        <div className="flex flex-col items-stretch w-full overflow-x-auto p-4 gap-8">
            {roundOrder.map(roundName => (
            <Card key={roundName} className="w-full">
                <CardHeader>
                <CardTitle className="text-lg font-bold text-primary">{roundName}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                <div className="flex flex-col">
                    {playoffs[roundName].map((match, matchIndex) => (
                        <React.Fragment key={match.id}>
                        <PlayoffMatchCard
                            match={match} 
                            roundName={roundName} 
                            matchIndex={matchIndex}
                            bracketKey={bracketKey || null}
                        />
                        {matchIndex < playoffs[roundName].length - 1 && <Separator />}
                        </React.Fragment>
                    ))}
                </div>
                </CardContent>
            </Card>
            ))}
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
                      <FormLabel>Estratégia de Sorteio/Cabeças de Chave</FormLabel>
                       <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className="flex flex-col space-y-1"
                        >
                          <div className="flex items-center space-x-3 space-y-0">
                              <RadioGroupItem value="balanced" id="balanced"/>
                            <Label htmlFor="balanced" className="font-normal">
                              Balanceado (1º vs Último)
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
                          disabled={form.watch('tournamentType') === 'doubleElimination'}
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
                 <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
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
                 </div>
              </div>
              {Object.keys(tournaments).map(categoryName => {
                  const categoryData = tournaments[categoryName];
                  if (!categoryData) return null;

                  const { formValues, tournamentData, playoffs } = categoryData;
                  const getBracketRounds = (bracket: PlayoffBracket | undefined) => {
                      if (!bracket) return {};
                      return Object.keys(bracket).reduce((acc, key) => {
                          if((bracket as PlayoffBracket)[key].length > 0) acc[key] = (bracket as PlayoffBracket)[key];
                          return acc;
                      }, {} as PlayoffBracket);
                  }

                  const upperBracket = getBracketRounds((playoffs as PlayoffBracketSet)?.upper);
                  const lowerBracket = getBracketRounds((playoffs as PlayoffBracketSet)?.lower);
                  const finalPlayoffs = getBracketRounds((playoffs as PlayoffBracketSet)?.playoffs);


                  return (
                  <TabsContent key={categoryName} value={categoryName}>
                      <Card className="min-h-full mt-4">
                        <CardHeader className="flex flex-row items-center justify-between">
                          <div>
                            <CardTitle>Gerenciador - {categoryName}</CardTitle>
                            <CardDescription>
                              {formValues.tournamentType === 'groups' && 'Visualize os grupos, preencha os resultados e acompanhe os playoffs.'}
                              {formValues.tournamentType === 'singleElimination' && 'Acompanhe e preencha os resultados do mata-mata.'}
                              {formValues.tournamentType === 'doubleElimination' && 'Gerencie as chaves superior, inferior e a fase final.'}
                            </CardDescription>
                          </div>
                           <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="icon" disabled={isLoading}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Esta ação não pode ser desfeita. Isso excluirá permanentemente a categoria
                                    "{categoryName}" e todos os seus dados.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteCategory(categoryName)}
                                    className="bg-destructive hover:bg-destructive/90"
                                  >
                                    Excluir
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                        </CardHeader>
                        <CardContent>
                           {isLoading && activeTab === categoryName && !tournamentData && !playoffs && (
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                              {[...Array(formValues.numberOfGroups || 0)].map((_, i) => (
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
                           
                           <div className="space-y-8">
                                {formValues.tournamentType === 'groups' && tournamentData && tournamentData.groups && tournamentData.groups.length > 0 && (
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
                                                    <TableHead className="p-2 text-center">V</TableHead>
                                                    <TableHead className="p-2 text-center">J</TableHead>
                                                    <TableHead className="p-2 text-center">PP</TableHead>
                                                    <TableHead className="p-2 text-center">SP</TableHead>
                                                </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                {group.standings.map((standing, index) => (
                                                    <TableRow key={teamToKey(standing.team)} className={index < formValues.teamsPerGroupToAdvance! ? "bg-green-100 dark:bg-green-900/30" : ""}>
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
                                            <div className="space-y-2">
                                            {group.matches.map((match, matchIndex) => (
                                                <div key={matchIndex} className="relative flex items-center gap-4">
                                                <div className="flex flex-col items-center gap-1">
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
                                                        <Input type="number" className="h-7 w-14 text-center" value={match.score1 ?? ''} onChange={(e) => handleGroupMatchChange(groupIndex, matchIndex, 'score1', e.target.value)} />
                                                        <span className="text-muted-foreground">x</span>
                                                        <Input type="number" className="h-7 w-14 text-center" value={match.score2 ?? ''} onChange={(e) => handleGroupMatchChange(groupIndex, matchIndex, 'score2', e.target.value)} />
                                                    </div>
                                                    <span className="flex-1 text-left truncate">{teamToKey(match.team2)}</span>
                                                </div>
                                                </div>
                                            ))}
                                            </div>
                                        </div>
                                        </CardContent>
                                    </Card>
                                    ))}
                                </div>
                                )}
                                
                                {formValues.tournamentType === 'singleElimination' && playoffs && (
                                     <Card>
                                        <CardHeader>
                                        <CardTitle className="flex items-center"><Trophy className="mr-2 h-5 w-5 text-primary" />Playoffs - Mata-Mata</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <Bracket playoffs={playoffs as PlayoffBracket} />
                                        </CardContent>
                                    </Card>
                                )}

                                {formValues.tournamentType === 'doubleElimination' && playoffs && (
                                    <div className="space-y-6">
                                        {Object.keys(upperBracket).length > 0 && <Card>
                                            <CardHeader>
                                                <CardTitle className="flex items-center"><Trophy className="mr-2 h-5 w-5 text-primary" />Chave Superior (Winners)</CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                <Bracket playoffs={upperBracket} bracketKey="upper" />
                                            </CardContent>
                                        </Card>}
                                         {Object.keys(lowerBracket).length > 0 && <Card>
                                            <CardHeader>
                                                <CardTitle className="flex items-center"><Trophy className="mr-2 h-5 w-5 text-accent" />Chave Inferior (Losers)</CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                <Bracket playoffs={lowerBracket} bracketKey="lower"/>
                                            </CardContent>
                                        </Card>}
                                         {Object.keys(finalPlayoffs).length > 0 && <Card>
                                            <CardHeader>
                                                <CardTitle className="flex items-center"><Trophy className="mr-2 h-5 w-5 text-yellow-500" />Fase Final</CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                <Bracket playoffs={finalPlayoffs} bracketKey="playoffs"/>
                                            </CardContent>
                                        </Card>}
                                    </div>
                                )}

                                {formValues.tournamentType === 'groups' && playoffs && (
                                    <Card>
                                        <CardHeader>
                                        <CardTitle className="flex items-center"><Trophy className="mr-2 h-5 w-5 text-primary" />Playoffs - Mata-Mata</CardTitle>
                                        <CardDescription>
                                            Chaveamento gerado com base na classificação dos grupos.
                                        </CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                        <Bracket playoffs={playoffs as PlayoffBracket} />
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                           
                        </CardContent>
                      </Card>
                  </TabsContent>
                )})}
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

    



    