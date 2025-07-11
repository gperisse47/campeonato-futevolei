
"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import Papa from "papaparse";
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
import { Loader2, Swords, Search, Save, AlertCircle, RefreshCcw, Upload, Download, RotateCcw, Trash2 } from "lucide-react";
import type { ConsolidatedMatch, PlayoffBracket, PlayoffBracketSet, CategoryData, TournamentsState, Court } from "@/lib/types";
import { getTournaments, updateMatch, updateMultipleMatches, importScheduleFromCSV, clearAllSchedules } from "@/app/actions";
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
  const [isImporting, setIsImporting] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [savingStates, setSavingStates] = useState<Record<string, boolean>>({});
  const [courts, setCourts] = useState<Court[]>([]);
  const [globalStartTime, setGlobalStartTime] = useState<string>('08:00');
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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
        if (savedTournaments._globalSettings) {
            setCourts(savedTournaments._globalSettings.courts || []);
            setGlobalStartTime(savedTournaments._globalSettings.startTime || '08:00');
        }
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
      
      // 1. Check against global start time
      if (matchToValidate.time < globalStartTime) {
          return `Horário antes do início do torneio (${globalStartTime}).`;
      }

      const startTime = parseTime(matchToValidate.time);
      const endTime = addMinutes(startTime, matchDuration);
      
      // 2. Check court availability in schedule
      const courtSlot = courts.find(c => c.name === matchToValidate.court);
      if (courtSlot) {
        const isInValidSlot = courtSlot.slots.some(slot => 
          isWithinInterval(startTime, { start: parseTime(slot.startTime), end: addMinutes(parseTime(slot.endTime), -matchDuration) })
        );
        if (!isInValidSlot) {
          return `Horário fora do funcionamento da quadra.`;
        }
      }

      // 3. Check for court conflicts
      const courtConflict = allCurrentMatches.find(m => 
          m.id !== matchToValidate.id &&
          m.court === matchToValidate.court &&
          m.time === matchToValidate.time
      );
      if (courtConflict) return `Conflito: ${courtConflict.court} já está em uso.`;
      
      // 4. Check for player conflicts
      if (matchToValidate.players.length > 0) {
        const playerConflict = allCurrentMatches.find(m =>
            m.id !== matchToValidate.id &&
            m.time === matchToValidate.time &&
            m.players.some(p => matchToValidate.players.includes(p))
        );
        if (playerConflict) return `Conflito: Um jogador já está em outro jogo.`;
      }
      
      return undefined;
  }, [courts, globalStartTime]);

  const handleFieldChange = (matchId: string, field: 'time' | 'court', value: string) => {
    // Treat 'none' from Select as an empty string for data consistency.
    const finalValue = field === 'court' && value === 'none' ? '' : value;

    setFilteredMatches(prev => {
      // Create a temporary updated list to run validations against
      const tempMatches = [...prev];
      const matchIndex = tempMatches.findIndex(m => m.id === matchId);
      if (matchIndex === -1) return prev; // Should not happen

      const originalMatch = tempMatches[matchIndex];
      const updatedMatch = { ...originalMatch, [field]: finalValue, isDirty: true };
      
      // Re-validate just the changed match first
      updatedMatch.validationError = validateChange(updatedMatch, tempMatches);
      
      tempMatches[matchIndex] = updatedMatch;
      
      // Now, re-validate any other match that might be affected by this change
      const validatedMatches = tempMatches.map(m => {
          if (m.id !== matchId && (m.time === updatedMatch.time || m.court === updatedMatch.court)) {
             const error = validateChange(m, tempMatches);
             return { ...m, validationError: error };
          }
          return m;
      });

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
      await loadMatchesAndSettings();
    } else {
      toast({
        variant: "destructive",
        title: "Erro ao Salvar",
        description: result.error || "Não foi possível atualizar o jogo.",
      });
      await loadMatchesAndSettings();
    }
    setSavingStates(prev => ({ ...prev, [match.id]: false }));
  };
  
  const handleSaveAllChanges = async () => {
    setIsSavingAll(true);
    const dirtyMatches = filteredMatches.filter(m => m.isDirty && !m.validationError);
    
    const matchesToUpdate = dirtyMatches.map(m => ({
        matchId: m.id,
        categoryName: m.category,
        time: m.time,
        court: m.court
    }));

    const result = await updateMultipleMatches(matchesToUpdate);
    
    if (result.success) {
      toast({
        title: "Jogos Atualizados!",
        description: "Todos os horários e quadras foram salvos com sucesso.",
      });
      await loadMatchesAndSettings();
    } else {
      toast({
        variant: "destructive",
        title: "Erro ao Salvar",
        description: result.error || "Não foi possível atualizar todos os jogos.",
      });
    }
    setIsSavingAll(false);
  };
  
  const handleResetAllChanges = () => {
      const resetMatches = allMatches.map(m => {
          if (m.isDirty) {
              return {
                  ...m,
                  time: m.originalTime,
                  court: m.originalCourt,
                  isDirty: false,
                  validationError: undefined,
              };
          }
          return m;
      });
      setFilteredMatches(resetMatches);
      toast({
          title: "Alterações Desfeitas",
          description: "Todas as mudanças não salvas foram revertidas."
      });
  };

  const handleClearAllSchedules = async () => {
    setIsClearing(true);
    const result = await clearAllSchedules();
    if(result.success) {
        toast({
            title: "Agendamento Limpo!",
            description: "Todos os horários e quadras foram removidos."
        });
        await loadMatchesAndSettings();
    } else {
         toast({
            variant: "destructive",
            title: "Erro ao Limpar",
            description: result.error || "Não foi possível limpar o agendamento.",
        });
    }
    setIsClearing(false);
  }

  const handleExportCSV = () => {
    const csvData = Papa.unparse(
      allMatches.map(m => ({
        matchId: m.id,
        category: m.category,
        stage: m.stage,
        team1: m.team1,
        team2: m.team2,
        time: m.time,
        court: m.court,
      }))
    );

    const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "horarios.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const csvData = e.target?.result as string;
      const result = await importScheduleFromCSV(csvData);

      if (result.success) {
        toast({
          title: "Importação Concluída!",
          description: "Os horários e quadras foram atualizados com sucesso.",
        });
        await loadMatchesAndSettings();
      } else {
        toast({
          variant: "destructive",
          title: "Erro na Importação",
          description: result.error || "Não foi possível importar o arquivo.",
        });
      }
      setIsImporting(false);
      // Reset file input
      if(fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };
  
  const hasDirtyMatches = useMemo(() => filteredMatches.some(m => m.isDirty), [filteredMatches]);
  const hasValidationErrors = useMemo(() => filteredMatches.some(m => !!m.validationError), [filteredMatches]);

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
            Ajuste os horários e quadras. Você pode salvar linha por linha ou todas as alterações de uma vez.
          </CardDescription>
          <div className="flex flex-col sm:flex-row gap-2 mt-4 flex-wrap justify-between items-center">
            <div className="relative flex-1 min-w-[250px] w-full sm:w-auto">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Buscar por dupla, categoria, fase..."
                className="pl-8 w-full"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2 justify-start sm:justify-end w-full sm:w-auto">
                <div className="flex gap-2">
                    <Button onClick={handleExportCSV}>
                        <Download className="mr-2 h-4 w-4" />
                        Exportar
                    </Button>
                    <Button onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
                        {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                        Importar
                    </Button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept=".csv"
                        onChange={handleFileChange}
                    />
                </div>
                <div className="flex gap-2">
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="outline" disabled={!hasDirtyMatches || isSavingAll}>
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Resetar
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                            <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Esta ação irá reverter todas as alterações não salvas nesta página.
                            </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={handleResetAllChanges}>Confirmar</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    <Button onClick={handleSaveAllChanges} disabled={!hasDirtyMatches || hasValidationErrors || isSavingAll}>
                        {isSavingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Salvar Tudo
                    </Button>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={isClearing}>
                                {isClearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                Limpar
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                            <AlertDialogTitle>Limpar todo o agendamento?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Esta ação removerá TODOS os horários e quadras de TODAS as partidas. Esta ação não pode ser desfeita.
                            </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={handleClearAllSchedules} className="bg-destructive hover:bg-destructive/90">Confirmar Limpeza</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>
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
                  {filteredMatches.map((match, index) => {
                    const isSaving = savingStates[match.id];
                    return (
                    <TableRow key={`${match.category}-${match.id}-${index}`}>
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
                          value={match.court || 'none'}
                          onValueChange={(value) => handleFieldChange(match.id, 'court', value)}
                        >
                          <SelectTrigger className={cn(match.validationError && "border-destructive focus:ring-destructive")}>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Não definida</SelectItem>
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
