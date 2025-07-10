
"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Users, Pencil, Search } from "lucide-react";
import { getTournaments, updateTeamInTournament } from "@/app/actions";
import { useAuth } from "@/context/AuthContext";
import { LoginPage } from "@/components/login-page";
import type { Team, TournamentsState, CategoryData } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

type TeamWithCategory = {
  team: Team;
  category: string;
};

export default function TeamsPage() {
  const [allTeams, setAllTeams] = useState<TeamWithCategory[]>([]);
  const [filteredTeams, setFilteredTeams] = useState<TeamWithCategory[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editingTeam, setEditingTeam] = useState<{ original: TeamWithCategory, updated: Team} | null>(null);
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();

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
        setFilteredTeams(uniqueTeams); // Initialize filtered list
      }
    } catch (error) {
      console.error("Failed to load teams from DB", error);
       toast({
        variant: "destructive",
        title: "Erro ao Carregar Duplas",
        description: "Não foi possível carregar a lista de duplas.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAuthenticated) {
      loadTeams();
    } else if (!isAuthLoading) {
      setIsLoading(false);
    }
  }, [isAuthenticated, isAuthLoading, loadTeams]);

  useEffect(() => {
    const results = allTeams.filter(item => {
      const teamString = `${item.team.player1} ${item.team.player2} ${item.category}`.toLowerCase();
      return teamString.includes(searchTerm.toLowerCase());
    });
    setFilteredTeams(results);
  }, [searchTerm, allTeams]);


  const handleEditClick = (teamWithCategory: TeamWithCategory) => {
    setEditingTeam({
        original: teamWithCategory,
        updated: { ...teamWithCategory.team }
    });
  };

  const handleFieldChange = (field: 'player1' | 'player2', value: string) => {
    if (editingTeam) {
        setEditingTeam({
            ...editingTeam,
            updated: {
                ...editingTeam.updated,
                [field]: value
            }
        });
    }
  };

  const handleSaveChanges = async () => {
    if (!editingTeam) return;

    setIsEditing(true);
    const { original, updated } = editingTeam;

    const result = await updateTeamInTournament(original.category, original.team, updated);

    if (result.success) {
      toast({
        title: "Dupla Atualizada!",
        description: "Os nomes dos integrantes foram atualizados com sucesso.",
      });
      await loadTeams(); // Reload all teams to reflect the change
      setEditingTeam(null);
    } else {
      toast({
        variant: "destructive",
        title: "Erro ao Salvar",
        description: result.error || "Não foi possível atualizar a dupla.",
      });
    }
    setIsEditing(false);
  };
  
  const teamToKey = (team: Team) => `${team.player1}-${team.player2}`;

  if (isAuthLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center">
            <Users className="mr-2 h-8 w-8" />
            Gerenciador de Duplas
        </h1>
        <p className="text-muted-foreground">
          Lista de todas as duplas inscritas. Use a busca para filtrar e o botão de edição para corrigir nomes.
        </p>
      </div>
      <Card>
        <CardHeader>
            <CardTitle>Lista de Duplas</CardTitle>
            <CardDescription>
                Visualize, filtre e edite todas as duplas e suas respectivas categorias.
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
                  <TableHead>Categoria</TableHead>
                  <TableHead>Nome da Dupla</TableHead>
                  <TableHead>Integrante 1</TableHead>
                  <TableHead>Integrante 2</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTeams.map((item, index) => (
                  <TableRow key={`${teamToKey(item.team)}-${item.category}-${index}`}>
                    <TableCell>{item.category}</TableCell>
                    <TableCell className="font-medium">{`${item.team.player1} e ${item.team.player2}`}</TableCell>
                    <TableCell>{item.team.player1}</TableCell>
                    <TableCell>{item.team.player2}</TableCell>
                    <TableCell className="text-right">
                        <Button variant="outline" size="icon" onClick={() => handleEditClick(item)}>
                            <Pencil className="h-4 w-4" />
                        </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg h-full min-h-[200px]">
                <p className="text-muted-foreground">
                    {allTeams.length > 0 ? 'Nenhuma dupla encontrada para a busca atual.' : 'Nenhuma dupla encontrada. Gere uma categoria para ver as duplas aqui.'}
                </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingTeam} onOpenChange={(isOpen) => !isOpen && setEditingTeam(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Dupla</DialogTitle>
          </DialogHeader>
          {editingTeam && (
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Input value={editingTeam.original.category} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="player1">Integrante 1</Label>
                <Input
                  id="player1"
                  value={editingTeam.updated.player1}
                  onChange={(e) => handleFieldChange('player1', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="player2">Integrante 2</Label>
                <Input
                  id="player2"
                  value={editingTeam.updated.player2}
                  onChange={(e) => handleFieldChange('player2', e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button onClick={handleSaveChanges} disabled={isEditing}>
              {isEditing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar Alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
