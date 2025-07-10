

"use client"

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Trophy, Clock, Trash2, Swords, RefreshCcw, LayoutGrid, Pencil } from "lucide-react"
import { format, addMinutes, parse } from 'date-fns';

import { getTournaments, saveTournament, deleteTournament, renameTournament } from "@/app/actions"
import type { TournamentData, TeamStanding, PlayoffMatch, GroupWithScores, TournamentFormValues, Team, TournamentsState, CategoryData, PlayoffBracketSet, PlayoffBracket, GlobalSettings } from "@/lib/types"
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
  const activeTournamentData = activeCategoryData?.tournamentData;
  const activePlayoffs = activeCategoryData?.playoffs;
  const activeFormValues = activeCategoryData?.formValues;


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
  }, []);

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
      setTournaments(prev => {
        const newState = { ...prev };
        const data = newState[activeTab!];
        delete newState[activeTab!];
        newState[newCategoryName] = data;
        return newState;
      });

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

  const scheduleMatches = useCallback((categoryData: CategoryData, globalSettings: GlobalSettings): CategoryData => {
    const { formValues, tournamentData, playoffs } = categoryData;
    const { startTime: categoryStartTime } = formValues;
    const { estimatedMatchDuration, courts, startTime: globalStartTime } = globalSettings;

    const effectiveStartTime = categoryStartTime || globalStartTime;

    if (!effectiveStartTime || !estimatedMatchDuration || !courts || courts.length === 0) {
        return categoryData;
    }

    const allMatchesToSchedule: ({ source: string; match: any })[] = [];

    if (formValues.tournamentType === 'groups' && tournamentData?.groups) {
        tournamentData.groups.forEach(group => {
            group.matches.forEach(match => allMatchesToSchedule.push({ source: 'group', match }));
        });
    }
    if (playoffs) {
        const collectPlayoffMatches = (bracket: PlayoffBracket | PlayoffBracketSet | undefined) => {
            if (!bracket) return;
            if ('upper' in bracket || 'lower' in bracket || 'playoffs' in bracket) {
                const bracketSet = bracket as PlayoffBracketSet;
                collectPlayoffMatches(bracketSet.upper);
                collectPlayoffMatches(bracketSet.lower);
                collectPlayoffMatches(bracketSet.playoffs);
                return;
            }
            Object.values(bracket as PlayoffBracket).flat().sort((a, b) => (a.roundOrder || 0) - (b.roundOrder || 0)).forEach(match => allMatchesToSchedule.push({ source: 'playoff', match }));
        }
        collectPlayoffMatches(playoffs);
    }

    const baseDate = new Date();
    const parseTime = (timeStr: string) => {
        const [h, m] = timeStr.split(':').map(Number);
        return parse(`${h}:${m}`, 'HH:mm', baseDate);
    };

    const courtAvailability = courts.map((court, index) => ({
        index,
        name: court.name,
        slots: court.slots.map(slot => ({
            start: parseTime(slot.startTime),
            end: parseTime(slot.endTime)
        })).sort((a, b) => a.start.getTime() - b.start.getTime()),
        nextAvailableTime: parseTime(effectiveStartTime)
    }));

    allMatchesToSchedule.forEach(({ match }) => {
        let bestCourtIndex = -1;
        let bestTime: Date | null = null;

        for (let i = 0; i < courtAvailability.length; i++) {
            const court = courtAvailability[i];
            let potentialStartTime = court.nextAvailableTime;

            let slotFound = false;
            for (const slot of court.slots) {
                // If potential start is before this slot, move it to the start of the slot
                if (potentialStartTime < slot.start) {
                    potentialStartTime = slot.start;
                }
                
                const potentialEndTime = addMinutes(potentialStartTime, estimatedMatchDuration);

                // Check if the match fits within this slot
                if (potentialEndTime <= slot.end) {
                    slotFound = true;
                    break; 
                }
                // If it doesn't fit, we continue to the next slot (the loop will handle this)
            }
            
            // If a valid start time was found in the slots for this court
            if (slotFound) {
                 // Check if this court offers an earlier start time than the best one found so far
                 if (bestTime === null || potentialStartTime < bestTime) {
                    bestTime = potentialStartTime;
                    bestCourtIndex = i;
                }
            }
        }
        
        if (bestCourtIndex !== -1 && bestTime) {
            const assignedCourt = courtAvailability[bestCourtIndex];
            match.time = format(bestTime, 'HH:mm');
            match.court = assignedCourt.name;
            // Update this court's next available time for the next match
            assignedCourt.nextAvailableTime = addMinutes(bestTime, estimatedMatchDuration);
        } else {
            // Fallback or error handling if no slot can be found for the match
            match.time = 'N/A';
            match.court = 'N/A';
        }
    });

    return categoryData;
}, []);
  
  const getTeamPlaceholder = useCallback((groupIndex: number, position: number) => {
    const groupLetter = String.fromCharCode(65 + groupIndex);
    return `${position}º do Grupo ${groupLetter}`;
  }, []);

  const updatePlayoffs = useCallback(() => {
    if (!activeTab || !activeCategoryData) return;

    const { playoffs, formValues, tournamentData } = activeCategoryData;
    if (!playoffs) return;

    const newPlayoffs = JSON.parse(JSON.stringify(playoffs)) as PlayoffBracketSet;
    const winners: { [matchName: string]: Team | undefined } = {};
    const losers: { [matchName: string]: Team | undefined } = {};
    const teamNameMap: { [key: string]: Team } = {};
    if (formValues.tournamentType === 'doubleElimination') {
        const teamsArray: Team[] = formValues.teams
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean)
          .map((teamString) => {
            const players = teamString.split(/\s+e\s+/i).map((p) => p.trim())
            return { player1: players[0] || "", player2: players[1] || "" }
        });
        teamsArray.forEach(t => teamNameMap[teamToKey(t)] = t);
    }

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
                            winners[match.id] = match.team1;
                            losers[match.id] = match.team2;
                        } else if (match.score2 > match.score1) {
                            winners[match.id] = match.team2;
                            losers[match.id] = match.team1;
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
                        } else if (formValues.tournamentType === 'doubleElimination' && teamNameMap[placeholder]) {
                            match.team1 = teamNameMap[placeholder];
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
                        } else if (formValues.tournamentType === 'doubleElimination' && teamNameMap[placeholder]) {
                            match.team2 = teamNameMap[placeholder];
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

    const passes = formValues.tournamentType === 'doubleElimination' ? 10 : 5;
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
        [activeTab!]: updatedCategoryData,
      }))
      saveData(activeTab!, updatedCategoryData);
    }
  
}, [activeTab, activeCategoryData, getTeamPlaceholder, tournaments]);


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

  const handleGroupMatchChange = (groupIndex: number, matchIndex: number, field: 'score1' | 'score2', value: string) => {
    if (!activeTab || !activeTournamentData) return;
    let newTournamentData = JSON.parse(JSON.stringify(activeTournamentData));
    
    const score = value === '' ? undefined : parseInt(value, 10);
    newTournamentData.groups[groupIndex].matches[matchIndex][field] = isNaN(score!) ? undefined : score;
    
    const updatedDataWithStandings = calculateStandings(newTournamentData);
    const updatedCategoryData = {
      ...activeCategoryData!,
      tournamentData: updatedDataWithStandings
    };

    setTournaments(prev => ({
        ...prev,
        [activeTab!]: updatedCategoryData,
    }));

    saveData(activeTab!, updatedCategoryData);
  }

  const handlePlayoffMatchChange = (bracketKey: keyof PlayoffBracketSet | null, roundName: string, matchIndex: number, field: 'score1' | 'score2', value: string) => {
    if (!activeTab || !activePlayoffs) return;
    let newPlayoffs = JSON.parse(JSON.stringify(activePlayoffs));

    let matchToUpdate;
    if (activeFormValues?.tournamentType === 'doubleElimination' && bracketKey && (newPlayoffs as PlayoffBracketSet)[bracketKey]) {
        matchToUpdate = (newPlayoffs as PlayoffBracketSet)[bracketKey]![roundName][matchIndex];
    } else {
        matchToUpdate = (newPlayoffs as PlayoffBracket)[roundName][matchIndex];
    }
    
    const score = value === '' ? undefined : parseInt(value, 10);
    matchToUpdate[field] = isNaN(score!) ? undefined : score;
    
    const updatedCategoryData = {
        ...activeCategoryData!,
        playoffs: newPlayoffs
    };
    setTournaments(prev => ({
        ...prev,
        [activeTab!]: updatedCategoryData,
    }));
    saveData(activeTab!, updatedCategoryData);
  };

  useEffect(() => {
    updatePlayoffs();
  }, [JSON.stringify(tournaments), activeTab, updatePlayoffs]);

  const PlayoffMatchCard = ({ match, roundName, matchIndex, bracketKey }: { match: PlayoffMatch, roundName: string, matchIndex: number, bracketKey: keyof PlayoffBracketSet | null }) => {
    const getWinner = (m: PlayoffMatch) => {
      if(m.score1 === undefined || m.score2 === undefined || m.score1 === m.score2) return null;
      return m.score1 > m.score2 ? m.team1 : m.team2;
    }
  
    const winnerTeam = getWinner(match);
    const winnerKey = winnerTeam ? teamToKey(winnerTeam) : null;
  
    const team1Key = match.team1 ? teamToKey(match.team1) : null;
    const team2Key = match.team2 ? teamToKey(match.team2) : null;
      
    const placeholder1 = (match.team1Placeholder || '').replace(/Vencedor Semifinal-\d/, 'Vencedor Semifinal').replace(/Perdedor Semifinal-\d/, 'Perdedor Semifinal');
    const placeholder2 = (match.team2Placeholder || '').replace(/Vencedor Semifinal-\d/, 'Vencedor Semifinal').replace(/Perdedor Semifinal-\d/, 'Perdedor Semifinal');
  
    const isFinalRound = roundName === 'Final' || roundName === 'Disputa de 3º Lugar';
    const showMatchName = roundName !== 'Final' && roundName !== 'Disputa de 3º Lugar';

    return (
      <div className="flex items-center">
        {/* Timeline */}
        <div className="relative w-24 flex-shrink-0 h-full flex justify-center">
            <div className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 text-center">
                <span className="font-semibold text-sm">{match.time ?? ''}</span>
                <span className="text-xs text-muted-foreground">{match.court ?? ''}</span>
            </div>
             <div className="w-px bg-border h-full" />
        </div>
  
        {/* Match Details */}
        <div className="flex-grow pl-4 py-4">
          <div className="flex flex-col gap-2 w-full">
              {showMatchName && <h4 className="text-sm font-semibold text-center text-muted-foreground whitespace-nowrap">{match.name}</h4> }
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

  const categories = Object.keys(tournaments).filter(k => k !== '_globalSettings');

  if (categories.length === 0) {
      return (
          <Card className="min-h-full">
              <CardContent>
                  <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg h-full min-h-[400px]">
                      <LayoutGrid className="h-12 w-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-semibold">Nenhuma Categoria Gerada</h3>
                      <p className="text-muted-foreground">Vá para o painel do administrador para criar a sua primeira categoria.</p>
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
                    <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <CardTitle>Gerenciador - {categoryName}</CardTitle>
                        <CardDescription className="flex items-center gap-2 pt-1">
                          {formValues.tournamentType === 'groups' && 'Visualize os grupos, preencha os resultados e acompanhe os playoffs.'}
                          {formValues.tournamentType === 'singleElimination' && 'Acompanhe e preencha os resultados do mata-mata.'}
                          {formValues.tournamentType === 'doubleElimination' && 'Gerencie as chaves superior, inferior e a fase final.'}
                           {totalMatches !== undefined && (
                            <span className="flex items-center text-xs font-medium text-muted-foreground border-l pl-2 ml-2">
                                <Swords className="mr-1.5 h-4 w-4" />
                                {totalMatches} Jogos
                            </span>
                           )}
                        </CardDescription>
                      </div>
                       <div className="flex items-center gap-2">
                            <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="icon" disabled={isLoading}>
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
                                                <div className="flex flex-col items-center gap-1 text-center w-20">
                                                    <span className="font-semibold text-sm">{match.time ?? ''}</span>
                                                    <span className="text-xs text-muted-foreground">{match.court ?? ''}</span>
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
