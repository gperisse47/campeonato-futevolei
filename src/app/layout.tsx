
"use client";

import type { Metadata } from 'next';
import './globals.css';
import { SidebarProvider, Sidebar, SidebarInset } from '@/components/ui/sidebar';
import { SidebarNav } from '@/components/sidebar-nav';
import { Header } from '@/components/header';
import { Toaster } from "@/components/ui/toaster"
import { AuthProvider } from '@/context/AuthContext';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Campeonato de Futevôlei Amigos do Peri</title>
        <meta name="description" content="Sistema de gerenciamento de campeonatos de futevôlei" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased">
        <AuthProvider>
            <SidebarProvider>
            <Sidebar>
                <SidebarNav />
            </Sidebar>
            <SidebarInset className="flex flex-col">
                <Header />
                <main className="flex-1 p-4 md:p-6">{children}</main>
            </SidebarInset>
            </SidebarProvider>
            <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
