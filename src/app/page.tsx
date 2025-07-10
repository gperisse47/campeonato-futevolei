
"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Trophy, ArrowRight } from "lucide-react";
import { getTournaments } from "@/app/actions";
import type { TournamentsState } from "@/lib/types";

export default function Home() {
  const [tournaments, setTournaments] = useState<TournamentsState>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTournaments = async () => {
      try {
        const data = await getTournaments();
        setTournaments(data);
      } catch (error) {
        console.error("Failed to load tournaments", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTournaments();
  }, []);

  const categories = Object.keys(tournaments);

  return (
    <div className="flex flex-col gap-8 items-center text-center">
      <div className="flex flex-col gap-2">
         <div className="flex items-center justify-center gap-3">
             <div className="p-2 rounded-lg bg-primary">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="hsl(var(--primary-foreground))"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-8 w-8"
                    >
                    <path d="M12 10.5c-1.2 0-2.5.5-3.5 1.5-1 1-1.5 2.3-1.5 3.5s.5 2.5 1.5 3.5c1 1 2.3 1.5 3.5 1.5s2.5-.5 3.5-1.5c1-1 1.5-2.3 1.5-3.5s-.5-2.5-1.5-3.5c-1-1-2.3-1.5-3.5-1.5Z" />
                    <path d="m5.5 13.5 1-1" />
                    <path d="m2 12 2-2" />
                    <path d="M12 2a10 10 0 0 0-10 10c0 4.4 3.6 8 8 8" />
                    <path d="m18.5 10.5 1 1" />
                    <path d="M22 12h-2" />
                    </svg>
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Bem-vindo ao Campeonato Amigos do Peri</h1>
         </div>
        <p className="text-muted-foreground text-lg">
          Acompanhe os torneios, jogos e classificações em tempo real.
        </p>
      </div>

      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center justify-center">
            <Trophy className="mr-2 h-6 w-6 text-primary" />
            Categorias em Andamento
          </CardTitle>
          <CardDescription>
            Selecione uma categoria para ver os detalhes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : categories.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {categories.map((category) => (
                <Button key={category} variant="outline" asChild className="justify-between">
                  <Link href={`/tournament/${encodeURIComponent(category)}`}>
                    {category}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground p-4 border-2 border-dashed rounded-lg">
              <p>Nenhum torneio foi gerado ainda.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
