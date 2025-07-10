
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
import { LayoutGrid, Users, Trophy, Loader2, Swords, Home, Settings, PlusCircle } from "lucide-react"
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
        if (savedTournaments) {
          setTournaments(savedTournaments);
        }
      } catch (error) {
        console.error("Failed to load tournaments for sidebar", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadTournaments();

    const intervalId = setInterval(loadTournaments, 5000); 

    return () => clearInterval(intervalId);
  }, []);

  const categories = Object.keys(tournaments).filter(k => k !== '_globalSettings');

  return (
    <>
      <SidebarHeader>
        <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary text-primary-foreground">
                <Trophy className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold tracking-tight">Campeonato de Futevôlei Amigos do Peri</h2>
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
                 <div className="px-2 mb-2 text-xs font-semibold text-muted-foreground tracking-wider">ADMINISTRAÇÃO</div>
                 <SidebarMenuItem>
                    <Link href="/admin/settings" passHref>
                        <SidebarMenuButton isActive={pathname === '/admin/settings'} tooltip="Configurações Globais">
                            <Settings />
                            <span>Configurações</span>
                        </SidebarMenuButton>
                    </Link>
                </SidebarMenuItem>
                 <SidebarMenuItem>
                    <Link href="/admin" passHref>
                        <SidebarMenuButton isActive={pathname === '/admin'} tooltip="Criar Nova Categoria">
                            <PlusCircle />
                            <span>Criar Categoria</span>
                        </SidebarMenuButton>
                    </Link>
                </SidebarMenuItem>
                 <SidebarMenuItem>
                    <Link href="/admin/teams" passHref>
                        <SidebarMenuButton isActive={pathname === '/admin/teams'} tooltip="Gerenciador de Duplas">
                            <Users/>
                            <span>Gerenciador de Duplas</span>
                        </SidebarMenuButton>
                    </Link>
                </SidebarMenuItem>
                 <SidebarMenuItem>
                    <Link href="/admin/gerenciador" passHref>
                        <SidebarMenuButton isActive={pathname === '/admin/gerenciador'} tooltip="Gerenciador de Categorias">
                            <LayoutGrid />
                            <span>Gerenciador de Categorias</span>
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
