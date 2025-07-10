
"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Swords } from "lucide-react";
import type { ConsolidatedMatch, PlayoffBracket, PlayoffBracketSet, PlayoffMatch } from "@/lib/types";
import { getTournaments } from "@/app/actions";

export default function MatchesPage() {
  const [matches, setMatches] = useState<ConsolidatedMatch[]>([]);
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
          const allMatches: ConsolidatedMatch[] = [];

          const processBracket = (bracket: PlayoffBracket, categoryName: string) => {
            for (const roundName in bracket) {
              const roundMatches = bracket[roundName];
              if (Array.isArray(roundMatches)) {
                roundMatches.forEach(match => {
                  allMatches.push({
                    category: categoryName,
                    stage: match.name,
                    team1: match.team1 ? teamToKey(match.team1) : match.team1Placeholder,
                    team2: match.team2 ? teamToKey(match.team2) : match.team2Placeholder,
                    score1: match.score1,
                    score2: match.score2,
                    time: match.time,
                  });
                });
              }
            }
          };

          for (const categoryName in savedTournaments) {
            const categoryData = savedTournaments[categoryName];

            // Group Stage Matches
            if (categoryData.tournamentData?.groups) {
              categoryData.tournamentData.groups.forEach(group => {
                group.matches.forEach(match => {
                  allMatches.push({
                    category: categoryName,
                    stage: group.name,
                    team1: teamToKey(match.team1),
                    team2: teamToKey(match.team2),
                    score1: match.score1,
                    score2: match.score2,
                    time: match.time,
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
          setMatches(allMatches);
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
        </CardHeader>
        <CardContent>
          {isLoading ? (
             <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : matches.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Horário</TableHead>
                  <TableHead>Fase</TableHead>
                  <TableHead className="text-right">Dupla 1</TableHead>
                  <TableHead className="text-center">Placar</TableHead>
                  <TableHead>Dupla 2</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matches.map((match, index) => (
                  <TableRow key={`${match.category}-${match.stage}-${index}`}>
                    <TableCell className="font-medium">{match.category}</TableCell>
                    <TableCell>{match.time || ''}</TableCell>
                    <TableCell>{match.stage}</TableCell>
                    <TableCell className="text-right">{match.team1}</TableCell>
                    <TableCell className="text-center font-bold">
                        {match.score1 !== undefined && match.score2 !== undefined ? (
                           `${match.score1} x ${match.score2}`
                        ) : (
                            'vs'
                        )}
                    </TableCell>
                    <TableCell>{match.team2}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg h-full min-h-[200px]">
                <p className="text-muted-foreground">Nenhum jogo encontrado. Gere uma categoria para ver os jogos aqui.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
