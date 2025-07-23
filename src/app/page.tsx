
"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Trophy, ArrowRight } from "lucide-react";
import { getTournaments } from "@/app/actions";
import type { TournamentsState } from "@/lib/types";
import Image from "next/image";

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

  const categories = Object.keys(tournaments).filter(k => k !== '_globalSettings');

  return (
    <div className="flex flex-col gap-8 items-center text-center">
      <div className="flex flex-col gap-4 items-center">
         <div className="flex items-center justify-center gap-3">
            <h2 className="text-4xl font-bold tracking-tight">Campeonato de Futevôlei Amigos do Peri</h2>
         </div>
         <Image
            src="/logo.png"
            alt="Logo do Torneio"
            width={130}
            height={130}
            priority
          />
      </div>

      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center justify-center">
            <Trophy className="mr-2 h-6 w-6 text-primary" />
            Categorias em Andamento
          </CardTitle>
          <CardDescription>
          Acompanhe os jogos e classificações em tempo real.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : categories.length > 0 ? (
            <div className="flex flex-col items-center gap-4">
              {categories.map((category) => (
                <Button key={category} variant="outline" asChild className="justify-between w-full max-w-sm">
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
