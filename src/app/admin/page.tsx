
"use client"

import * as React from 'react';
import { LoginPage } from "@/components/login-page";
import { useAuth } from '@/context/AuthContext';
import { Loader2 } from 'lucide-react';
import { TournamentCreator } from '@/components/tournament-creator';


export default function AdminPage() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Painel do Administrador</h1>
        <p className="text-muted-foreground">
          Use as opções abaixo para configurar o torneio e criar novas categorias.
        </p>
      </div>
      <TournamentCreator />
    </div>
  );
}
