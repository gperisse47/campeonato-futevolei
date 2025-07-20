

"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Trophy, Clock, Trash2, Swords, RefreshCcw, LayoutGrid, Pencil, MapPin } from "lucide-react"

import { getTournaments, saveTournament, deleteTournament, renameTournament, regenerateCategory, updateMatch } from "@/app/actions"
import type { TournamentData, TeamStanding, PlayoffMatch, GroupWithScores, TournamentFormValues, Team, TournamentsState, CategoryData, PlayoffBracketSet, PlayoffBracket, GlobalSettings, MatchWithScore } from "@/lib/types"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "./ui/skeleton"
import { Separator } from "./ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import Link from "next/link"
import { Label } from "./ui/label"


const teamToKey = (team?: Team) => {
    if (!team || !team.player1 || !team.player2) return '';
    return `${team.player1} e ${team.player2}`;
};


export function CategoryManager() {
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false);
  const [tournaments, setTournaments] = useState<TournamentsState>({ _globalSettings: { startTime: "08:00", estimatedMatchDuration: 20, courts: [{name: "Quadra 1", slots: [{startTime: "09:00", endTime: "18:00"}]}] }})
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const { toast } = useToast()
  
  const activeCategoryData = activeTab ? tournaments[activeTab] : null;

  const getFirstMatchTime = (categoryData: CategoryData | null): string | null => {
    if (!categoryData) return null;

    let allMatches: (MatchWithScore | PlayoffMatch)[] = [];
    if (categoryData.tournamentData?.groups) {
        allMatches.push(...categoryData.tournamentData.groups.flatMap(g => g.matches));
    }
    if (categoryData.playoffs) {
        if ('upper' in categoryData.playoffs || 'lower' in categoryData.playoffs || 'playoffs' in categoryData.playoffs) {
            const bracketSet = categoryData.playoffs as PlayoffBracketSet;
            if(bracketSet.upper) allMatches.push(...Object.values(bracketSet.upper).flat());
            if(bracketSet.lower) allMatches.push(...Object.values(bracketSet.lower).flat());
            if(bracketSet.playoffs) allMatches.push(...Object.values(bracketSet.playoffs).flat());
        } else {
            allMatches.push(...Object.values(categoryData.playoffs as PlayoffBracket).flat());
        }
    }

    const sortedMatches = allMatches
        .filter(m => m.time && m.time !== 'N/A')
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        
    return sortedMatches.length > 0 ? sortedMatches[0].time! : null;
  };


  // Load initial data from the "DB"
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const savedTournaments = await getTournaments();
        setTournaments(savedTournaments);
        const categories = Object.keys(savedTournaments).filter(k => k !== '_globalSettings');
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

  useEffect(() => {
    if (activeTab) {
      setNewCategoryName(activeTab);
    }
  }, [activeTab]);

  const saveData = async (categoryName: string, data: CategoryData) => {
    setIsSaving(true);
    const result = await saveTournament(categoryName, data);
    if (!result.success) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: result.error || "Não foi possível salvar as alterações.",
      });
    } else {
        const updatedTournaments = await getTournaments();
        setTournaments(updatedTournaments);
    }
    setIsSaving(false);
  };

  const handleRenameCategory = async () => {
    if (!activeTab || !newCategoryName || activeTab === newCategoryName) {
      setIsRenameDialogOpen(false);
      return;
    }

    setIsLoading(true);
    const result = await renameTournament(activeTab, newCategoryName);

    if (result.success) {
      toast({
        title: "Categoria Renomeada!",
        description: `"${activeTab}" foi renomeada para "${newCategoryName}".`,
      });

      // Update state locally
      const updatedTournaments = await getTournaments();
      setTournaments(updatedTournaments);
      setActiveTab(newCategoryName);
      setIsRenameDialogOpen(false);
    } else {
      toast({
        variant: "destructive",
        title: "Erro ao Renomear",
        description: result.error || "Não foi possível renomear a categoria.",
      });
    }
    setIsLoading(false);
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

      const remainingCategories = Object.keys(newTournaments).filter(k => k !== '_globalSettings');
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

  const handleRegenerateCategory = async (categoryName: string) => {
    setIsLoading(true);
    const result = await regenerateCategory(categoryName);
    if (result.success) {
        toast({
            title: "Categoria Regenerada!",
            description: `A categoria "${categoryName}" foi recriada com sucesso.`,
        });
        const updatedTournaments = await getTournaments();
        setTournaments(updatedTournaments);
    } else {
        toast({
            variant: "destructive",
            title: "Erro ao Regenerar",
            description: result.error || "Não foi possível regenerar a categoria.",
        });
    }
    setIsLoading(false);
};
  
  const updatePlayoffs = (categoryData: CategoryData): CategoryData => {
    const { playoffs, formValues, tournamentData } = categoryData;
    if (!playoffs) return categoryData;

    const newPlayoffs = JSON.parse(JSON.stringify(playoffs));
    const winners: { [matchId: string]: Team } = {};
    const losers: { [matchId: string]: Team } = {};
    const groupQualifiers: { [placeholder: string]: Team } = {};

    // 1. Populate group qualifiers if groups are finished
    if (tournamentData?.groups) {
      tournamentData.groups.forEach(group => {
        const allMatchesFinished = group.matches.every(m => typeof m.score1 === 'number' && typeof m.score2 === 'number');
        if (allMatchesFinished) {
          group.standings.slice(0, formValues.teamsPerGroupToAdvance).forEach((standing, index) => {
            const categoryPrefix = formValues.category.replace(/\s/g, '');
            const groupNameId = group.name.replace(/\s/g, '');
            const placeholder = `${index + 1}º do ${categoryPrefix}-${groupNameId}`;
            groupQualifiers[placeholder] = standing.team;
          });
        }
      });
    }
    
    // 2. Populate winners and losers from playoff matches
    const processBracketForWinners = (bracket?: PlayoffBracket) => {
      if (!bracket) return;
      Object.values(bracket).flat().forEach(match => {
        if (match.team1 && match.team2 && typeof match.score1 === 'number' && typeof match.score2 === 'number') {
          if (match.score1 > match.score2) {
            winners[match.id] = match.team1;
            losers[match.id] = match.team2;
          } else if (match.score2 > match.score1) {
            winners[match.id] = match.team2;
            losers[match.id] = match.team1;
          }
        }
      });
    };

    if ('upper' in newPlayoffs || 'lower' in newPlayoffs || 'playoffs' in newPlayoffs) {
      processBracketForWinners((newPlayoffs as PlayoffBracketSet).upper);
      processBracketForWinners((newPlayoffs as PlayoffBracketSet).lower);
      processBracketForWinners((newPlayoffs as PlayoffBracketSet).playoffs);
    } else {
      processBracketForWinners(newPlayoffs as PlayoffBracket);
    }

    // 3. Resolve placeholders iteratively
    const resolvePlaceholdersInBracket = (bracket?: PlayoffBracket) => {
      if (!bracket) return;
      Object.values(bracket).flat().forEach(match => {
        if (!match.team1 && match.team1Placeholder) {
          if (groupQualifiers[match.team1Placeholder]) {
            match.team1 = groupQualifiers[match.team1Placeholder];
          } else if (match.team1Placeholder.startsWith('Vencedor')) {
            const depId = match.team1Placeholder.replace('Vencedor ', '').trim();
            if (winners[depId]) match.team1 = winners[depId];
          } else if (match.team1Placeholder.startsWith('Perdedor')) {
            const depId = match.team1Placeholder.replace('Perdedor ', '').trim();
            if (losers[depId]) match.team1 = losers[depId];
          }
        }
        if (!match.team2 && match.team2Placeholder) {
          if (groupQualifiers[match.team2Placeholder]) {
            match.team2 = groupQualifiers[match.team2Placeholder];
          } else if (match.team2Placeholder.startsWith('Vencedor')) {
            const depId = match.team2Placeholder.replace('Vencedor ', '').trim();
            if (winners[depId]) match.team2 = winners[depId];
          } else if (match.team2Placeholder.startsWith('Perdedor')) {
            const depId = match.team2Placeholder.replace('Perdedor ', '').trim();
            if (losers[depId]) match.team2 = losers[depId];
          }
        }
      });
    };

    for (let i = 0; i < 5; i++) { // Iterate multiple times to resolve chained dependencies
       if ('upper' in newPlayoffs || 'lower' in newPlayoffs || 'playoffs' in newPlayoffs) {
          resolvePlaceholdersInBracket((newPlayoffs as PlayoffBracketSet).upper);
          resolvePlaceholdersInBracket((newPlayoffs as PlayoffBracketSet).lower);
          resolvePlaceholdersInBracket((newPlayoffs as PlayoffBracketSet).playoffs);
      } else {
          resolvePlaceholdersInBracket(newPlayoffs as PlayoffBracket);
      }
    }

    return { ...categoryData, playoffs: newPlayoffs };
  };


  const calculateStandings = (currentTournamentData: TournamentData): TournamentData => {
    const groupsArray = Array.isArray(currentTournamentData.groups)
        ? currentTournamentData.groups
        : Object.values(currentTournamentData.groups);

    const newGroups = groupsArray.map(group => {
        const standings: Record<string, TeamStanding> = {};

        group.teams.forEach(team => {
            const teamKey = teamToKey(team);
            standings[teamKey] = { team, played: 0, wins: 0, setsWon: 0, setDifference: 0 };
        });

        group.matches.forEach(match => {
            const { team1, team2, score1, score2 } = match;
            if (score1 === undefined || score2 === undefined) return;

            const team1Key = teamToKey(team1);
            const team2Key = teamToKey(team2);

            if (standings[team1Key]) standings[team1Key].played++;
            if (standings[team2Key]) standings[team2Key].played++;

            if (score1 > score2) {
                if (standings[team1Key]) standings[team1Key].wins++;
            } else if (score2 > score1) {
                if (standings[team2Key]) standings[team2Key].wins++;
            }

            if (standings[team1Key]) standings[team1Key].setsWon += score1;
            if (standings[team2Key]) standings[team2Key].setsWon += score2;
        });
        
        const sortedStandings = Object.values(standings).map(s => {
            let setsLost = 0;
            group.matches.forEach(m => {
                if(m.score1 === undefined || m.score2 === undefined) return;
                if (teamToKey(m.team1) === teamToKey(s.team)) {
                    setsLost += m.score2;
                }
                if (teamToKey(m.team2) === teamToKey(s.team)) {
                    setsLost += m.score1;
                }
            });
            return {
              ...s,
              setDifference: s.setsWon - setsLost
            }
        }).sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.setDifference !== a.setDifference) return b.setDifference - a.setDifference;
          return b.setsWon - a.setsWon;
        });

        return { ...group, standings: sortedStandings };
    });

    return { groups: newGroups };
  };

  const handleGroupMatchChange = (groupIndex: number, matchIndex: number, field: 'score1' | 'score2', value: string) => {
    if (!activeTab || !activeCategoryData) return;
    
    let currentCategoryData = JSON.parse(JSON.stringify(activeCategoryData));
    const score = value === '' ? undefined : parseInt(value, 10);
    
    // Ensure groups is an array before modification
    const groupsArray = Array.isArray(currentCategoryData.tournamentData.groups) 
        ? currentCategoryData.tournamentData.groups
        : Object.values(currentCategoryData.tournamentData.groups);

    groupsArray[groupIndex].matches[matchIndex][field] = isNaN(score!) ? undefined : score;
    currentCategoryData.tournamentData.groups = groupsArray; // Assign back the array

    const updatedDataWithStandings = calculateStandings(currentCategoryData.tournamentData);
    currentCategoryData.tournamentData = updatedDataWithStandings;

    const finalUpdatedCategoryData = updatePlayoffs(currentCategoryData);

    setTournaments(prev => ({
        ...prev,
        [activeTab!]: finalUpdatedCategoryData,
    }));

    saveData(activeTab!, finalUpdatedCategoryData);
  };

  const handlePlayoffMatchChange = (bracketKey: keyof PlayoffBracketSet | null, roundName: string, matchIndex: number, field: 'score1' | 'score2', value: string) => {
    if (!activeTab || !activeCategoryData) return;

    let currentCategoryData = JSON.parse(JSON.stringify(activeCategoryData));
    let matchToUpdate;
    if (currentCategoryData.formValues?.tournamentType === 'doubleElimination' && bracketKey && (currentCategoryData.playoffs as PlayoffBracketSet)[bracketKey]) {
        matchToUpdate = (currentCategoryData.playoffs as PlayoffBracketSet)[bracketKey]![roundName][matchIndex];
    } else {
        matchToUpdate = (currentCategoryData.playoffs as PlayoffBracket)[roundName][matchIndex];
    }
    
    const score = value === '' ? undefined : parseInt(value, 10);
    matchToUpdate[field] = isNaN(score!) ? undefined : score;
    
    const finalUpdatedCategoryData = updatePlayoffs(currentCategoryData);

    setTournaments(prev => ({
        ...prev,
        [activeTab!]: finalUpdatedCategoryData
    }));
    saveData(activeTab!, finalUpdatedCategoryData);
  };

  const PlayoffMatchCard = ({ match, roundName, matchIndex, bracketKey }: { match: PlayoffMatch, roundName: string, matchIndex: number, bracketKey: keyof PlayoffBracketSet | null }) => {
    const getWinner = (m: PlayoffMatch) => {
      if(m.score1 === undefined || m.score2 === undefined || m.score1 === m.score2) return null;
      return m.score1 > m.score2 ? m.team1 : m.team2;
    }
  
    const winnerTeam = getWinner(match);
    const winnerKey = winnerTeam ? teamToKey(winnerTeam) : null;
  
    const team1Key = match.team1 ? teamToKey(match.team1) : null;
    const team2Key = match.team2 ? teamToKey(match.team2) : null;
      
    const placeholder1 = (match.team1Placeholder || '');
    const placeholder2 = (match.team2Placeholder || '');
  
    const isFinalRound = roundName === 'Final' || roundName === 'Disputa de 3º Lugar';
    const showMatchName = roundName !== 'Final' && roundName !== 'Disputa de 3º Lugar';

    return (
        <div className="flex flex-col gap-2 w-full px-4 py-4">
            <div className="flex flex-col items-center justify-center text-center gap-2">
              {showMatchName && <h4 className="text-sm font-semibold text-muted-foreground whitespace-nowrap">{match.name}</h4>}
               {(match.time || match.court) && (
                  <div className="flex items-center gap-4 text-sm font-bold text-primary">
                      {match.time && <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {match.time}</span>}
                      {match.court && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" /> {match.court}</span>}
                  </div>
              )}
            </div>
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
                <div className="flex flex-col divide-y">
                    {playoffs[roundName].map((match, matchIndex) => (
                        <PlayoffMatchCard
                            key={match.id}
                            match={match} 
                            roundName={roundName} 
                            matchIndex={matchIndex}
                            bracketKey={bracketKey || null}
                        />
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

  const categories = Object.keys(tournaments).filter(k => k !== '_globalSettings');

  if (categories.length === 0) {
      return (
          <Card className="min-h-full">
              <CardContent>
                  <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg h-full min-h-[400px]">
                      <LayoutGrid className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold">Nenhuma Categoria Gerada</h3>
                      <p className="text-muted-foreground">Vá para o painel de criação para criar sua primeira categoria.</p>
                      <Button asChild className="mt-4">
                          <Link href="/admin">Criar Categoria</Link>
                      </Button>
                  </div>
              </CardContent>
          </Card>
      );
  }


  return (
    <div className="w-full">
        {activeTab ? (
         <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <div className="flex items-center justify-between gap-4">
            <TabsList className="hidden sm:inline-flex">
                {categories.map(cat => (
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
                      {categories.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
             </div>
          </div>
          {categories.map(categoryName => {
              const categoryData = tournaments[categoryName];
              if (!categoryData) return null;

              const { formValues, tournamentData, playoffs, totalMatches } = categoryData;
              const firstMatchTime = getFirstMatchTime(categoryData);

              const groupsToRender = tournamentData?.groups ? (Array.isArray(tournamentData.groups) ? tournamentData.groups : Object.values(tournamentData.groups)) : [];

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
                    <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                      <div>
                        <CardTitle>Gerenciador - {categoryName}</CardTitle>
                        <CardDescription className="flex items-center flex-wrap gap-x-4 gap-y-1 pt-2">
                           {totalMatches !== undefined && (
                            <span className="flex items-center text-xs font-medium text-muted-foreground">
                                <Swords className="mr-1.5 h-4 w-4" />
                                {totalMatches} Jogos
                            </span>
                           )}
                           {formValues.startTime && (
                               <span className="flex items-center text-xs font-medium text-muted-foreground">
                                <Clock className="mr-1.5 h-4 w-4" />
                                Início Desejado: {formValues.startTime}
                            </span>
                           )}
                           {firstMatchTime && (
                                <span className="flex items-center text-xs font-medium text-muted-foreground">
                                <Clock className="mr-1.5 h-4 w-4 text-primary" />
                                Início Real: {firstMatchTime}
                            </span>
                           )}
                        </CardDescription>
                      </div>
                       <div className="flex items-center gap-2 self-start sm:self-center">
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="outline" size="icon" disabled={isLoading} title="Regenerar Categoria">
                                        <RefreshCcw className="h-4 w-4" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                    <AlertDialogTitle>Regenerar Categoria?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Isto irá apagar todos os placares e o chaveamento atual e gerar um novo com base nos parâmetros originais. Esta ação não pode ser desfeita.
                                    </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction
                                        onClick={() => handleRegenerateCategory(categoryName)}
                                        className="bg-primary hover:bg-primary/90"
                                    >
                                        Regenerar
                                    </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                            <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="icon" disabled={isLoading} title="Renomear Categoria">
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Renomear Categoria</DialogTitle>
                                        <DialogDescription>
                                            Escolha um novo nome para a categoria "{activeTab}".
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="grid gap-4 py-4">
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="new-category-name" className="text-right">
                                                Nome
                                            </Label>
                                            <Input
                                                id="new-category-name"
                                                value={newCategoryName}
                                                onChange={(e) => setNewCategoryName(e.target.value)}
                                                className="col-span-3"
                                            />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <DialogClose asChild>
                                            <Button type="button" variant="secondary">
                                                Cancelar
                                            </Button>
                                        </DialogClose>
                                        <Button onClick={handleRenameCategory} disabled={isLoading}>
                                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Salvar
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="destructive" size="icon" disabled={isLoading} title="Excluir Categoria">
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
                       </div>
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
                            {formValues.tournamentType === 'groups' && tournamentData && groupsToRender.length > 0 && (
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                {groupsToRender.map((group, groupIndex) => (
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
                                            <div key={match.id || matchIndex} className="flex flex-col gap-2 rounded-md bg-secondary/50 p-2 text-sm">
                                                {(match.time || match.court) && (
                                                    <div className="flex items-center justify-center gap-4 text-sm font-bold text-primary">
                                                        {match.time && <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {match.time}</span>}
                                                        {match.court && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" /> {match.court}</span>}
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between gap-2">
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

                            {formValues.tournamentType === 'groups' && playoffs && Object.keys(playoffs).length > 0 && (
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
  )
}
