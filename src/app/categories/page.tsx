
"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2, Trophy, ExternalLink } from "lucide-react";
import type { TournamentsState } from "@/lib/types";
import { getTournaments } from "@/app/actions";

export default function CategoriesPage() {
  const [tournaments, setTournaments] = useState<TournamentsState>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadCategories = async () => {
        try {
            const savedTournaments = await getTournaments();
            if (savedTournaments) {
                setTournaments(savedTournaments);
            }
        } catch (error) {
            console.error("Failed to load tournaments from DB", error);
        } finally {
            setIsLoading(false);
        }
    };
    
    loadCategories();
  }, []);

  const categories = Object.keys(tournaments);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center">
            <Trophy className="mr-2 h-8 w-8" />
            Categorias do Torneio
        </h1>
        <p className="text-muted-foreground">
          Lista de todas as categorias geradas e links para suas páginas públicas.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Lista de Categorias</CardTitle>
          <CardDescription>
            Visualize todas as categorias e acesse suas páginas de acompanhamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
             <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : categories.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome da Categoria</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => (
                  <TableRow key={category}>
                    <TableCell className="font-medium">{category}</TableCell>
                    <TableCell className="text-right">
                        <Button variant="outline" size="sm" asChild>
                            <Link href={`/tournament/${encodeURIComponent(category)}`} target="_blank">
                                Ver Página <ExternalLink className="ml-2 h-4 w-4" />
                            </Link>
                        </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg h-full min-h-[200px]">
                <p className="text-muted-foreground">Nenhuma categoria encontrada. Gere uma nova na Página do Administrador.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
