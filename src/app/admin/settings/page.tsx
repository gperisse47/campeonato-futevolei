
"use client"

import * as React from 'react';
import { LoginPage } from "@/components/login-page";
import { useAuth } from '@/context/AuthContext';
import { Loader2 } from 'lucide-react';
import { GlobalSettings } from '@/components/global-settings';

export default function SettingsPage() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
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
        <h1 className="text-3xl font-bold tracking-tight">Configurações Globais</h1>
        <p className="text-muted-foreground">
          Parâmetros que afetam todas as categorias do torneio.
        </p>
      </div>
      <GlobalSettings />
    </div>
  );
}
