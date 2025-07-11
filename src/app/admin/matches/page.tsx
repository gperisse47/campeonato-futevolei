
"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { LoginPage } from "@/components/login-page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
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
import { Loader2, Swords, Search, Save, AlertCircle, RefreshCcw } from "lucide-react";
import type { ConsolidatedMatch, PlayoffBracket, PlayoffBracketSet, CategoryData, TournamentsState, Court } from "@/lib/types";
import { getTournaments, updateMatch, resetAllSchedules } from "@/app/actions";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { format, parse, addMinutes, isWithinInterval } from 'date-fns';
import { cn } from "@/lib/utils";

type EditableMatch = ConsolidatedMatch & {
  id: string; // Ensure id is present
  players: string[];
  originalTime: string;
  originalCourt: string;
  isDirty?: boolean;
  validationError?: string;
};

const parseTime = (timeStr: string): Date => {
    if (!timeStr) return new Date(0);
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
};

export default function AdminMatchesPage() {
  const [allMatches, setAllMatches] = useState<EditableMatch[]>([]);
  const [filteredMatches, setFilteredMatches] = useState<EditableMatch[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const [savingStates, setSavingStates] = useState<Record<string, boolean>>({});
  const [courts, setCourts] = useState<Court[]>([]);
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();

  const teamToKey = (team: any): string => {
    if (!team) return '';
    const players = [team.player1, team.player2].sort();
    return `${players[0]} e ${players[1]}`;
  };

  const getPlayers = (team1?: string, team2?: string): string[] => {
      const players = new Set<string>();
      [team1, team2].forEach(team => {
          if(!team) return;
          if (team.includes(' e ')) {
              team.split(' e ').forEach(p => players.add(p.trim()));
          }
      });
      return Array.from(players);
  }

  const loadMatchesAndSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const savedTournaments = await getTournaments();
      if (savedTournaments) {
        setCourts(savedTournaments._globalSettings?.courts || []);
        const allMatchesData: EditableMatch[] = [];

        const processBracket = (bracket: PlayoffBracket, categoryName: string) => {
          for (const roundName in bracket) {
            const roundMatches = bracket[roundName];
            if (Array.isArray(roundMatches)) {
              roundMatches.forEach(match => {
                const team1Str = match.team1 ? teamToKey(match.team1) : match.team1Placeholder;
                const team2Str = match.team2 ? teamToKey(match.team2) : match.team2Placeholder;
                allMatchesData.push({
                  id: match.id,
                  category: categoryName,
                  stage: match.name,
                  team1: team1Str,
                  team2: team2Str,
                  score1: match.score1,
                  score2: match.score2,
                  time: match.time || '',
                  court: match.court || '',
                  originalTime: match.time || '',
                  originalCourt: match.court || '',
                   players: getPlayers(team1Str, team2Str),
                });
              });
            }
          }
        };

        for (const categoryName in savedTournaments) {
          if (categoryName === '_globalSettings') continue;

          const categoryData = savedTournaments[categoryName] as CategoryData;

          if (categoryData.tournamentData?.groups) {
            categoryData.tournamentData.groups.forEach(group => {
              group.matches.forEach(match => {
                allMatchesData.push({
                  id: match.id!,
                  category: categoryName,
                  stage: group.name,
                  team1: teamToKey(match.team1),
                  team2: teamToKey(match.team2),
                  score1: match.score1,
                  score2: match.score2,
                  time: match.time || '',
                  court: match.court || '',
                  originalTime: match.time || '',
                  originalCourt: match.court || '',
                  players: getPlayers(teamToKey(match.team1), teamToKey(match.team2)),
                });
              });
            });
          }

          if (categoryData.playoffs) {
            const playoffs = categoryData.playoffs as PlayoffBracketSet;
             if (categoryData.formValues.tournamentType === 'doubleElimination' && ('upper' in playoffs || 'lower' in playoffs || 'playoffs' in playoffs)) {
                  if (playoffs.upper) processBracket(playoffs.upper, categoryName);
                  if (playoffs.lower) processBracket(playoffs.lower, categoryName);
                  if (playoffs.playoffs) processBracket(playoffs.playoffs, categoryName);
              } else {
                  processBracket(playoffs as PlayoffBracket, categoryName);
              }
          }
        }

        allMatchesData.sort((a, b) => {
          if (!a.time) return 1;
          if (!b.time) return -1;
          return a.time.localeCompare(b.time);
        });

        setAllMatches(allMatchesData);
        setFilteredMatches(allMatchesData);
      }
    } catch (error) {
      console.error("Failed to load matches from DB", error);
      toast({ variant: "destructive", title: "Erro ao Carregar Jogos" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAuthenticated) {
      loadMatchesAndSettings();
    }
  }, [isAuthenticated, loadMatchesAndSettings]);

  useEffect(() => {
    const results = allMatches.filter(match => {
      const matchString = `${match.category} ${match.stage} ${match.team1} ${match.team2} ${match.court}`.toLowerCase();
      return matchString.includes(searchTerm.toLowerCase());
    });
    setFilteredMatches(results);
  }, [searchTerm, allMatches]);

  const validateChange = useCallback((matchToValidate: EditableMatch, allCurrentMatches: EditableMatch[]): string | undefined => {
      if (!matchToValidate.time || !matchToValidate.court) return undefined;
      
      const matchDuration = 20; // Assume fixed duration for now
      const startTime = parseTime(matchToValidate.time);
      const endTime = addMinutes(startTime, matchDuration);
      
      // 1. Check court availability in schedule
      const courtSlot = courts.find(c => c.name === matchToValidate.court);
      if (courtSlot) {
        const isInValidSlot = courtSlot.slots.some(slot => 
          isWithinInterval(startTime, { start: parseTime(slot.startTime), end: addMinutes(parseTime(slot.endTime), -matchDuration) })
        );
        if (!isInValidSlot) {
          return `Horário fora do funcionamento da quadra.`;
        }
      }

      // 2. Check for court conflicts
      const courtConflict = allCurrentMatches.find(m => 
          m.id !== matchToValidate.id &&
          m.court === matchToValidate.court &&
          m.time === matchToValidate.time
      );
      if (courtConflict) return `Conflito: ${courtConflict.court} já está em uso.`;
      
      // 3. Check for player conflicts
      if (matchToValidate.players.length > 0) {
        const playerConflict = allCurrentMatches.find(m =>
            m.id !== matchToValidate.id &&
            m.time === matchToValidate.time &&
            m.players.some(p => matchToValidate.players.includes(p))
        );
        if (playerConflict) return `Conflito: Um jogador já está em outro jogo.`;
      }
      
      return undefined;
  }, [courts]);

  const handleFieldChange = (matchId: string, field: 'time' | 'court', value: string) => {
    setFilteredMatches(prev => {
      // Create a temporary updated list to run validations against
      let tempMatches = [...prev];
      let matchIndex = tempMatches.findIndex(m => m.id === matchId);
      if (matchIndex === -1) return prev; // Should not happen

      // Update the specific match that changed
      tempMatches[matchIndex] = { ...tempMatches[matchIndex], [field]: value, isDirty: true };
      
      // Now, re-validate all matches based on this temporary state
      // This is necessary because a change in one match can create or resolve a conflict in another.
      const validatedMatches = tempMatches.map(m => ({
          ...m,
          validationError: validateChange(m, tempMatches)
      }));

      return validatedMatches;
    });
  };
  
  const handleSaveChanges = async (match: EditableMatch) => {
    setSavingStates(prev => ({ ...prev, [match.id]: true }));
    const result = await updateMatch({
      matchId: match.id,
      categoryName: match.category,
      time: match.time,
      court: match.court,
    });
    
    if (result.success) {
      toast({
        title: "Jogo Atualizado!",
        description: "O horário e/ou quadra do jogo foram salvos.",
      });
      // After a successful save, reload all data to get the fresh state from the server
      await loadMatchesAndSettings();
    } else {
      toast({
        variant: "destructive",
        title: "Erro ao Salvar",
        description: result.error || "Não foi possível atualizar o jogo.",
      });
       // Revert the visual change on error by remapping from the original `allMatches` state
      setFilteredMatches(prev => {
          const originalMatchState = allMatches.find(am => am.id === match.id);
          return prev.map(m => m.id === match.id ? (originalMatchState || m) : m);
      });
    }
    setSavingStates(prev => ({ ...prev, [match.id]: false }));
  };

  const handleResetSchedules = async () => {
    setIsResetting(true);
    const result = await resetAllSchedules();
    if (result.success) {
        toast({
            title: "Horários Resetados",
            description: "Todos os horários de jogos foram limpos."
        });
        await loadMatchesAndSettings();
    } else {
        toast({
            variant: "destructive",
            title: "Erro ao Resetar",
            description: result.error || "Não foi possível limpar os horários."
        });
    }
    setIsResetting(false);
  }

  if (isAuthLoading) {
    return <div className="flex h-screen w-full items-center justify-center"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center">
          <Swords className="mr-2 h-8 w-8" />
          Gerenciador de Jogos
        </h1>
        <p className="text-muted-foreground">
          Edite os horários e quadras de todos os jogos do torneio.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Todos os Jogos</CardTitle>
          <CardDescription>
            Ajuste os horários e quadras e clique em salvar para cada linha. As alterações são validadas em tempo real.
          </CardDescription>
          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Buscar por dupla, categoria, fase..."
                className="pl-8 w-full"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isResetting}>
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Resetar Todos os Horários
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação removerá todos os horários e quadras de TODOS os jogos. 
                    Esta ação não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleResetSchedules} className="bg-destructive hover:bg-destructive/90">
                    {isResetting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Sim, resetar horários
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredMatches.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">Horário</TableHead>
                    <TableHead className="w-[180px]">Quadra</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Fase</TableHead>
                    <TableHead className="text-right">Dupla 1</TableHead>
                    <TableHead className="text-center w-[50px]">Placar</TableHead>
                    <TableHead>Dupla 2</TableHead>
                    <TableHead className="text-right w-[80px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMatches.map((match) => {
                    const isSaving = savingStates[match.id];
                    return (
                    <TableRow key={match.id}>
                      <TableCell>
                        <Input
                          type="time"
                          value={match.time}
                          onChange={(e) => handleFieldChange(match.id, 'time', e.target.value)}
                          className={cn("w-full", match.validationError && "border-destructive focus-visible:ring-destructive")}
                          step="1200"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={match.court}
                          onValueChange={(value) => handleFieldChange(match.id, 'court', value)}
                        >
                          <SelectTrigger className={cn(match.validationError && "border-destructive focus:ring-destructive")}>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            {courts.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                         {match.validationError && (
                            <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle className="h-3 w-3"/>{match.validationError}</p>
                         )}
                      </TableCell>
                      <TableCell className="font-medium">{match.category}</TableCell>
                      <TableCell>{match.stage}</TableCell>
                      <TableCell className="text-right">{match.team1}</TableCell>
                      <TableCell className="text-center font-bold">
                        {match.score1 !== undefined && match.score2 !== undefined
                          ? `${match.score1} x ${match.score2}`
                          : 'x'}
                      </TableCell>
                      <TableCell>{match.team2}</TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" onClick={() => handleSaveChanges(match)} disabled={isSaving || !!match.validationError || !match.isDirty}>
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )})}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg min-h-[200px]">
              <p className="text-muted-foreground">Nenhum jogo encontrado.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
