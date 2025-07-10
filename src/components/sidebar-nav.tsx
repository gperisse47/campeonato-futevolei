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
import { LayoutGrid, Users, Trophy, Loader2 } from "lucide-react"
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
    const intervalId = setInterval(loadTournaments, 5000); // Refresh every 5 seconds

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
                    <path d="M12 10.5c-1.2 0-2.5.5-3.5 1.5-1 1-1.5 2.3-1.5 3.5s.5 2.5 1.5 3.5c1 1 2.3 1.5 3.5 1.5s2.5-.5 3.5-1.5c1-1 1.5-2.3 1.5-3.5s-.5-2.5-1.5-3.5c-1-1-2.3-1.5-3.5-1.5Z" />
                    <path d="m5.5 13.5 1-1" />
                    <path d="m2 12 2-2" />
                    <path d="M12 2a10 10 0 0 0-10 10c0 4.4 3.6 8 8 8" />
                    <path d="m18.5 10.5 1 1" />
                    <path d="M22 12h-2" />
                    </svg>
            </div>
            <h2 className="text-lg font-semibold tracking-tight">Futevôlei Manager</h2>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <ScrollArea className="h-full">
            <SidebarMenu>
              <SidebarMenuItem>
                <Link href="/" passHref>
                    <SidebarMenuButton isActive={pathname === '/'} tooltip="Página do Administrador">
                      <LayoutGrid />
                      <span>Página do Administrador</span>
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
