
"use client"

import * as React from "react"
import { useState, useEffect } from "react"
import { useForm, useForm as useFormGlobal } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Settings } from "lucide-react"

import { getTournaments, saveGlobalSettings } from "@/app/actions"
import type { GlobalSettings, TournamentsState } from "@/lib/types"
import { globalSettingsSchema } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { TournamentCreator } from './tournament-creator'
import { CategoryManager } from './category-manager'

export function GroupGenerator() {
  const [isLoaded, setIsLoaded] = useState(false);
  
  useEffect(() => {
    setIsLoaded(true);
  }, []);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-1 flex flex-col gap-8">
            <TournamentCreator />
        </div>
        <div className="lg:col-span-2">
            <CategoryManager />
        </div>
    </div>
  )
}
