
"use client"

import * as React from 'react';
import { CategoryManager } from "@/components/category-manager";
import { LoginPage } from "@/components/login-page";
import { useAuth } from '@/context/AuthContext';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function TournamentManagerPage() {
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
        <h1 className="text-3xl font-bold tracking-tight">Gerenciador de Resultados</h1>
        <p className="text-muted-foreground">
          Gerencie os jogos, resultados e horários das categorias existentes. Para criar uma nova, vá para o {' '}
          <Button variant="link" asChild className="p-0 h-auto">
             <Link href="/admin">Painel de Criação</Link>
          </Button>.
        </p>
      </div>
      <CategoryManager />
    </div>
  );
}
