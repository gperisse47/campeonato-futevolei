

"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Loader2, Swords, Search } from "lucide-react";
import type { ConsolidatedMatch, PlayoffBracket, PlayoffBracketSet, CategoryData } from "@/lib/types";
import { getTournaments } from "@/app/actions";

export default function MatchesPage() {
  const [allMatches, setAllMatches] = useState<ConsolidatedMatch[]>([]);
  const [filteredMatches, setFilteredMatches] = useState<ConsolidatedMatch[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const teamToKey = (team: any) => {
    if (!team) return '';
    return `${team.player1} e ${team.player2}`;
  };

  useEffect(() => {
    const loadMatches = async () => {
      try {
        const savedTournaments = await getTournaments();
        if (savedTournaments) {
          const allMatchesData: ConsolidatedMatch[] = [];

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
                    time: match.time,
                    court: match.court,
                  });
                });
              }
            }
          };

          for (const categoryName in savedTournaments) {
            if (categoryName === '_globalSettings') continue;
            
            const categoryData = savedTournaments[categoryName] as CategoryData;

            // Group Stage Matches
            if (categoryData.tournamentData?.groups) {
              categoryData.tournamentData.groups.forEach(group => {
                group.matches.forEach(match => {
                  allMatchesData.push({
                    id: match.id,
                    category: categoryName,
                    stage: group.name,
                    team1: teamToKey(match.team1),
                    team2: teamToKey(match.team2),
                    score1: match.score1,
                    score2: match.score2,
                    time: match.time,
                    court: match.court,
                  });
                });
              });
            }

            // Playoff Matches
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

          // Sort matches by time
          allMatchesData.sort((a, b) => {
            if (!a.time || a.time === 'N/A') return 1;
            if (!b.time || b.time === 'N/A') return -1;
            return a.time.localeCompare(b.time);
          });

          setAllMatches(allMatchesData);
          setFilteredMatches(allMatchesData); // Initialize filtered list
        }
      } catch (error) {
        console.error("Failed to load matches from DB", error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadMatches();

    const intervalId = setInterval(loadMatches, 5000);
    return () => clearInterval(intervalId);

  }, []);

  useEffect(() => {
    const results = allMatches.filter(match => {
      const matchString = `${match.category} ${match.stage} ${match.team1} ${match.team2} ${match.court}`.toLowerCase();
      return matchString.includes(searchTerm.toLowerCase());
    });
    setFilteredMatches(results);
  }, [searchTerm, allMatches]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center">
            <Swords className="mr-2 h-8 w-8" />
            Lista de Jogos
        </h1>
        <p className="text-muted-foreground">
          Lista consolidada de todos os jogos do torneio.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Todos os Jogos</CardTitle>
          <CardDescription>
            Visualize todos os jogos, de todas as categorias e fases.
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Horário</TableHead>
                  <TableHead>Quadra</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Fase</TableHead>
                  <TableHead className="text-right">Dupla 1</TableHead>
                  <TableHead className="text-center">Placar</TableHead>
                  <TableHead>Dupla 2</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMatches.map((match) => (
                  <TableRow key={match.id}>
                    <TableCell>{match.time || ''}</TableCell>
                    <TableCell>{match.court || ''}</TableCell>
                    <TableCell className="font-medium">{match.category}</TableCell>
                    <TableCell>{match.stage}</TableCell>
                    <TableCell className="text-right">{match.team1}</TableCell>
                    <TableCell className="text-center font-bold">
                        {match.score1 !== undefined && match.score2 !== undefined ? (
                           `${match.score1} x ${match.score2}`
                        ) : (
                            'x'
                        )}
                    </TableCell>
                    <TableCell>{match.team2}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg h-full min-h-[200px]">
                <p className="text-muted-foreground">{allMatches.length > 0 ? 'Nenhum jogo encontrado para a busca atual.' : 'Nenhum jogo encontrado. Gere uma categoria para ver os jogos aqui.'}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
