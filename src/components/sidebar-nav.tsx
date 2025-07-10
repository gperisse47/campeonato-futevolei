"use client"

import {
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import { LayoutGrid, Users } from "lucide-react"
import { usePathname } from 'next/navigation'
import Link from 'next/link'

export function SidebarNav() {
  const pathname = usePathname();

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
        <SidebarMenu>
          <SidebarMenuItem>
            <Link href="/" passHref>
                <SidebarMenuButton isActive={pathname === '/'} tooltip="Gerador de Grupos">
                  <LayoutGrid />
                  <span>Gerador de Grupos</span>
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
      </SidebarContent>
    </>
  )
}
