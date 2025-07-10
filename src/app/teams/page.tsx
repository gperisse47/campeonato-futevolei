
"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Users } from "lucide-react";
import type { Team, TournamentsState, CategoryData } from "@/lib/types";
import { getTournaments } from "@/app/actions";

type TeamWithCategory = {
  team: Team;
  category: string;
};

export default function TeamsPage() {
  const [teams, setTeams] = useState<TeamWithCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadTeams = async () => {
        try {
            const savedTournaments = await getTournaments();
            if (savedTournaments) {
                const allTeams: TeamWithCategory[] = [];

                for (const categoryName in savedTournaments) {
                    if (categoryName === '_globalSettings') continue;

                    const categoryData = savedTournaments[categoryName] as CategoryData;
                    let teamsToProcess: Team[] = [];

                    if (categoryData.tournamentData?.groups) {
                         categoryData.tournamentData.groups.forEach(group => {
                            teamsToProcess.push(...group.teams);
                        });
                    } else if (categoryData.formValues?.teams) {
                        teamsToProcess = categoryData.formValues.teams
                            .split("\n")
                            .map((t: string) => t.trim())
                            .filter(Boolean)
                            .map((teamString: string) => {
                                const players = teamString.split(" e ").map((p) => p.trim())
                                return { player1: players[0] || '', player2: players[1] || '' }
                            });
                    }
                    
                    teamsToProcess.forEach(team => {
                        allTeams.push({ team, category: categoryName });
                    });
                }
                
                const uniqueTeams = allTeams.filter((v,i,a)=>a.findIndex(t=>(t.team.player1 === v.team.player1 && t.team.player2 === v.team.player2 && t.category === v.category))===i)
                setTeams(uniqueTeams);
            }
        } catch (error) {
            console.error("Failed to load teams from DB", error);
        } finally {
            setIsLoading(false);
        }
    };
    
    loadTeams();
  }, []);

  const teamToKey = (team: Team) => `${team.player1} e ${team.player2}`;

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
            Visualize todas as duplas e suas respectivas categorias.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
             <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : teams.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dupla</TableHead>
                  <TableHead>Categoria</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((item, index) => (
                  <TableRow key={`${teamToKey(item.team)}-${item.category}-${index}`}>
                    <TableCell className="font-medium">{teamToKey(item.team)}</TableCell>
                    <TableCell>{item.category}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg h-full min-h-[200px]">
                <p className="text-muted-foreground">Nenhuma dupla encontrada. Gere uma categoria para ver as duplas aqui.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
