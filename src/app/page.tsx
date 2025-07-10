
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
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-8 w-8"
                >
                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
                    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
                    <path d="M4 22h16"/>
                    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21A2.5 2.5 0 0 1 9 22H8a2.5 2.5 0 0 1-2.5-2.5V17c0-1.66 1.34-3 3-3h0c.35 0 .69.07 1 .18"/>
                    <path d="M14 14.66V17c0 .55.47.98.97 1.21A2.5 2.5 0 0 0 15 22h1a2.5 2.5 0 0 0 2.5-2.5V17c0-1.66-1.34-3-3-3h0c-.35 0-.69.07-1 .18"/>
                    <path d="M9 4h6"/>
                    <path d="M12 4v8"/>
                    <path d="M6 11H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h2"/>
                    <path d="M18 11h2a2 2 0 0 1 2 2v2c0 1.1-.9 2-2 2h-2"/>
                </svg>
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Campeonato Amigos do Peri</h1>
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
