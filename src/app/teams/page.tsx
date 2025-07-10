
"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Loader2, Users, Search } from "lucide-react";
import { getTournaments } from "@/app/actions";
import type { Team, TournamentsState, CategoryData } from "@/lib/types";

type TeamWithCategory = {
  team: Team;
  category: string;
};

export default function PublicTeamsPage() {
  const [allTeams, setAllTeams] = useState<TeamWithCategory[]>([]);
  const [filteredTeams, setFilteredTeams] = useState<TeamWithCategory[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const loadTeams = useCallback(async () => {
    try {
      const savedTournaments = await getTournaments();
      if (savedTournaments) {
        const teamsList: TeamWithCategory[] = [];
        for (const categoryName in savedTournaments) {
          if (categoryName === '_globalSettings') continue;

          const categoryData = savedTournaments[categoryName] as CategoryData;
          if (categoryData.formValues?.teams) {
            const teamsFromForm = categoryData.formValues.teams
              .split("\n")
              .map((t: string) => t.trim())
              .filter(Boolean)
              .map((teamString: string) => {
                const players = teamString.split(/\s+e\s+/i).map((p) => p.trim());
                return { player1: players[0] || '', player2: players[1] || '' };
              });
            
            teamsFromForm.forEach(team => {
              teamsList.push({ team, category: categoryName });
            });
          }
        }
        
        const uniqueTeams = teamsList.filter((v,i,a)=>a.findIndex(t=>(t.team.player1 === v.team.player1 && t.team.player2 === v.team.player2 && t.category === v.category))===i);
        setAllTeams(uniqueTeams);
        setFilteredTeams(uniqueTeams);
      }
    } catch (error) {
      console.error("Failed to load teams from DB", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    const results = allTeams.filter(item => {
      const teamString = `${item.team.player1} ${item.team.player2} ${item.category}`.toLowerCase();
      return teamString.includes(searchTerm.toLowerCase());
    });
    setFilteredTeams(results);
  }, [searchTerm, allTeams]);
  
  const teamToKey = (team: Team) => `${team.player1}-${team.player2}`;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center">
            <Users className="mr-2 h-8 w-8" />
            Duplas Inscritas
        </h1>
        <p className="text-muted-foreground">
          Lista de todas as duplas inscritas em cada categoria do torneio.
        </p>
      </div>
      <Card>
        <CardHeader>
            <CardTitle>Lista de Duplas</CardTitle>
            <CardDescription>
                Visualize e filtre todas as duplas e suas respectivas categorias.
            </CardDescription>
            <div className="relative mt-4">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    type="search"
                    placeholder="Buscar por dupla, jogador ou categoria..."
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
          ) : filteredTeams.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome da Dupla</TableHead>
                  <TableHead>Jogador 1</TableHead>
                  <TableHead>Jogador 2</TableHead>
                  <TableHead>Categoria</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTeams.map((item, index) => (
                  <TableRow key={`${teamToKey(item.team)}-${item.category}-${index}`}>
                    <TableCell className="font-medium">{`${item.team.player1} e ${item.team.player2}`}</TableCell>
                    <TableCell>{item.team.player1}</TableCell>
                    <TableCell>{item.team.player2}</TableCell>
                    <TableCell>{item.category}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg h-full min-h-[200px]">
                <p className="text-muted-foreground">
                    {allTeams.length > 0 ? 'Nenhuma dupla encontrada para a busca atual.' : 'Nenhuma dupla encontrada. Crie uma categoria para ver as duplas aqui.'}
                </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
