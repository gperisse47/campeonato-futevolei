
"use client"

import * as React from "react"
import {
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { LayoutGrid, Users, Trophy, Loader2, Swords, Home } from "lucide-react"
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { getTournaments } from "@/app/actions"
import type { TournamentsState } from "@/lib/types"

export function SidebarNav() {
  const pathname = usePathname();
  const [tournaments, setTournaments] = React.useState<TournamentsState>({});
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const loadTournaments = async () => {
      try {
        const savedTournaments = await getTournaments();
        setTournaments(savedTournaments);
      } catch (error) {
        console.error("Failed to load tournaments for sidebar", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadTournaments();

    // Set up an interval to refresh the categories list periodically
    const intervalId = setInterval(loadTournaments, 60000); // Refresh every 1 minute

    // Cleanup interval on component unmount
    return () => clearInterval(intervalId);
  }, []);

  const categories = Object.keys(tournaments);

  return (
    <>
      <SidebarHeader>
        <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary">
                 <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="hsl(var(--primary-foreground))"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-6 w-6"
                >
                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
                    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
                    <path d="M4 22h16"/>
                    <path d="M10 14.5a2.5 2.5 0 0 0-5 0V22h5v-7.5Z"/>
                    <path d="M19 14.5a2.5 2.5 0 0 0-5 0V22h5v-7.5Z"/>
                    <path d="M5 10V5c0-1.66 1.34-3 3-3h8c1.66 0 3 1.34 3 3v5"/>
                </svg>
            </div>
            <h2 className="text-lg font-semibold tracking-tight">Campeonato Amigos do Peri</h2>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <ScrollArea className="h-full">
            <SidebarMenu>
               <SidebarMenuItem>
                <Link href="/" passHref>
                    <SidebarMenuButton isActive={pathname === '/'} tooltip="Página Inicial">
                      <Home />
                      <span>Página Inicial</span>
                    </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/admin" passHref>
                    <SidebarMenuButton isActive={pathname === '/admin'} tooltip="Página do Administrador">
                      <LayoutGrid />
                      <span>Administrador</span>
                    </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Link href="/teams" passHref>
                    <SidebarMenuButton isActive={pathname === '/teams'} tooltip="Duplas">
                        <Users/>
                        <span>Duplas</span>
                    </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
               <SidebarMenuItem>
                <Link href="/matches" passHref>
                    <SidebarMenuButton isActive={pathname === '/matches'} tooltip="Jogos">
                        <Swords/>
                        <span>Jogos</span>
                    </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            </SidebarMenu>
            
            <SidebarSeparator className="my-4" />

            <SidebarMenu>
                <div className="px-2 mb-2 text-xs font-semibold text-muted-foreground tracking-wider">CATEGORIAS</div>
                {isLoading ? (
                    <div className="p-2 flex items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                ) : categories.length > 0 ? (
                    categories.map((category) => (
                         <SidebarMenuItem key={category}>
                            <Link href={`/tournament/${encodeURIComponent(category)}`} passHref>
                                <SidebarMenuButton isActive={pathname === `/tournament/${encodeURIComponent(category)}`} tooltip={category}>
                                    <Trophy/>
                                    <span>{category}</span>
                                </SidebarMenuButton>
                            </Link>
                        </SidebarMenuItem>
                    ))
                ) : (
                    <div className="px-2 text-xs text-muted-foreground">Nenhuma categoria gerada.</div>
                )}
            </SidebarMenu>
        </ScrollArea>
      </SidebarContent>
    </>
  )
}
