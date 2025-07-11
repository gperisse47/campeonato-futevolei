
"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { LoginPage } from "@/components/login-page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Swords, Search, Save } from "lucide-react";
import type { ConsolidatedMatch, PlayoffBracket, PlayoffBracketSet, CategoryData, TournamentsState, Court, GlobalSettings } from "@/lib/types";
import { getTournaments, updateMatch } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";

type EditableMatch = ConsolidatedMatch & {
  id: string; // Ensure id is present
  originalTime: string;
  originalCourt: string;
};

export default function AdminMatchesPage() {
  const [allMatches, setAllMatches] = useState<EditableMatch[]>([]);
  const [filteredMatches, setFilteredMatches] = useState<EditableMatch[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [courts, setCourts] = useState<Court[]>([]);
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();

  const teamToKey = (team: any): string => {
    if (!team) return '';
    const players = [team.player1, team.player2].sort();
    return `${players[0]} e ${players[1]}`;
  };

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
                allMatchesData.push({
                  id: match.id,
                  category: categoryName,
                  stage: match.name,
                  team1: match.team1 ? teamToKey(match.team1) : match.team1Placeholder,
                  team2: match.team2 ? teamToKey(match.team2) : match.team2Placeholder,
                  score1: match.score1,
                  score2: match.score2,
                  time: match.time || '',
                  court: match.court || '',
                  originalTime: match.time || '',
                  originalCourt: match.court || '',
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

  const handleFieldChange = (matchId: string, field: 'time' | 'court', value: string) => {
    setFilteredMatches(prev =>
      prev.map(m => (m.id === matchId ? { ...m, [field]: value } : m))
    );
  };
  
  const handleSaveChanges = async (match: EditableMatch) => {
    if (match.time === match.originalTime && match.court === match.originalCourt) {
        toast({ title: "Nenhuma alteração detectada." });
        return;
    }
    
    setIsSaving(true);
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
      await loadMatchesAndSettings(); // Recarrega para refletir e ordenar
    } else {
      toast({
        variant: "destructive",
        title: "Erro ao Salvar",
        description: result.error || "Não foi possível atualizar o jogo.",
      });
       // Reverte a alteração visual em caso de erro
      setFilteredMatches(prev => prev.map(m => m.id === match.id ? { ...m, time: m.originalTime, court: m.originalCourt } : m));
    }
    setIsSaving(false);
  };

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
            Ajuste os horários e quadras e clique em salvar para cada linha.
          </CardDescription>
          <div className="relative mt-4">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por dupla, categoria, fase..."
              className="pl-8 w-full"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
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
                    <TableHead className="w-[120px]">Horário</TableHead>
                    <TableHead className="w-[150px]">Quadra</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Fase</TableHead>
                    <TableHead className="text-right">Dupla 1</TableHead>
                    <TableHead className="text-center w-[50px]">Placar</TableHead>
                    <TableHead>Dupla 2</TableHead>
                    <TableHead className="text-right w-[80px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMatches.map((match) => (
                    <TableRow key={match.id}>
                      <TableCell>
                        <Input
                          type="time"
                          value={match.time}
                          onChange={(e) => handleFieldChange(match.id, 'time', e.target.value)}
                          className="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={match.court}
                          onValueChange={(value) => handleFieldChange(match.id, 'court', value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            {courts.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
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
                        <Button size="icon" onClick={() => handleSaveChanges(match)} disabled={isSaving}>
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
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
