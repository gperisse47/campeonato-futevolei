
"use client"

import * as React from 'react';
import Link from 'next/link';
import { LoginPage } from "@/components/login-page";
import { useAuth } from '@/context/AuthContext';
import { Loader2, LayoutGrid } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function AdminPage() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
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
                Selecione uma opção abaixo para gerenciar o torneio.
            </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <LayoutGrid className="h-6 w-6" />
                        Gerenciador de Torneios
                    </CardTitle>
                    <CardDescription>
                        Crie, edite e gerencie as categorias, jogos e resultados do torneio.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button asChild>
                        <Link href="/admin/gerenciador">Acessar Gerenciador</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    </div>
  );
}
