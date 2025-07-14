
"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Swords, AlertCircle, CalendarClock, GripVertical, PlusCircle, ArrowLeft } from "lucide-react";
import type { PlayoffBracket, PlayoffBracketSet, CategoryData, TournamentsState, Court, MatchWithScore, PlayoffMatch, Team, GlobalSettings } from "@/lib/types";
import { getTournaments } from "@/app/actions";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { format, parse, addMinutes, isWithinInterval, startOfDay, isBefore } from 'date-fns';
import { cn } from "@/lib/utils";
import { LoginPage } from "@/components/login-page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type SchedulableMatch = (MatchWithScore | PlayoffMatch) & {
  id: string;
  category: string;
  players: string[];
  team1Name: string;
  team2Name: string;
  stage: string;
  dependencies: string[];
  isGroupMatch: boolean;
};

type TimeSlot = {
  time: string;
  datetime: Date;
  courts: ({
    name: string;
    match?: SchedulableMatch;
  })[];
};

const parseTime = (timeStr: string): Date => {
    if (!timeStr) return new Date(0);
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = startOfDay(new Date());
    date.setHours(hours, minutes, 0, 0);
    return date;
};

const teamName = (team: Team | undefined, placeholder: string | undefined): string => {
    if (team && team.player1 && team.player2) return `${team.player1} e ${team.player2}`;
    return placeholder || "A Definir";
};

const getPlayersFromMatch = (match: SchedulableMatch): string[] => {
    const players = new Set<string>();
    [match.team1Name, match.team2Name].forEach(team => {
        if (!team) return;
        if (team.includes(' e ')) {
            team.split(' e ').forEach(p => players.add(p.trim()));
        }
    });
    return Array.from(players);
};

export default function ScheduleSnapshotPage() {
  const [allMatches, setAllMatches] = useState<any[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const router = useRouter();

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const savedTournaments = await getTournaments();
      const { _globalSettings } = savedTournaments;
      setGlobalSettings(_globalSettings);
      const loadedCourts = _globalSettings.courts || [];
      setCourts(loadedCourts);

      const storedSchedule = sessionStorage.getItem('partialSchedule');
      if (storedSchedule) {
        setAllMatches(JSON.parse(storedSchedule));
      } else {
        toast({
          variant: "destructive",
          title: "Nenhum Snapshot Encontrado",
          description: "Não há dados de agendamento parcial para exibir.",
        });
      }
    } catch (error) {
      console.error("Failed to load data", error);
      toast({ variant: "destructive", title: "Erro ao Carregar Dados" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated, loadData]);

  useEffect(() => {
    if (!courts.length || !allMatches.length || !globalSettings) return;

    const { startTime, endTime, estimatedMatchDuration } = globalSettings;
    const interval = estimatedMatchDuration || 20;

    const earliestTime = parseTime(startTime);
    const latestTime = parseTime(endTime || '23:59');

    const newTimeSlots: TimeSlot[] = [];
    let currentTime = earliestTime;
    while (isBefore(currentTime, latestTime)) {
        newTimeSlots.push({
            time: format(currentTime, 'HH:mm'),
            datetime: new Date(currentTime),
            courts: courts.map(c => ({ name: c.name, match: undefined })),
        });
        currentTime = addMinutes(currentTime, interval);
    }

    allMatches.forEach(match => {
        if (match.time && match.court) {
            const slot = newTimeSlots.find(ts => ts.time === match.time);
            if (slot) {
                const courtInSlot = slot.courts.find(c => c.name === match.court);
                if (courtInSlot && !courtInSlot.match) {
                    courtInSlot.match = match;
                } else if (courtInSlot) {
                    console.warn(`Slot conflict at ${slot.time} on ${match.court}. Match ${match.id} not placed.`);
                }
            }
        }
    });
    setTimeSlots(newTimeSlots);
  }, [courts, allMatches, globalSettings]);


  const scheduledMatchesMap = useMemo(() => {
    const map = new Map<string, any>();
    allMatches.forEach(m => {
        if (m.id && m.time) {
            map.set(m.id, m);
        }
    });
    return map;
  }, [allMatches]);

  if (isAuthLoading || (isAuthenticated && isLoading)) {
    return <div className="flex h-screen w-full items-center justify-center"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const MatchCard = ({ match }: { match: any }) => {
    return (
        <Card className="p-2 text-xs relative group h-full flex flex-col justify-center">
             <div className="font-bold text-center truncate">{match.category} - {match.stage}</div>
             <div className="text-muted-foreground mb-0.5 truncate text-center">{match.team1}</div>
             <div className="text-muted-foreground my-0.5 text-center">vs</div>
             <div className="text-muted-foreground mb-0.5 truncate text-center">{match.team2}</div>
        </Card>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
            <div className="flex justify-between items-start">
                <div>
                     <CardTitle className="flex items-center"><CalendarClock className="mr-2"/>Snapshot da Grade de Horários</CardTitle>
                     <CardDescription>Esta é a grade no momento em que o agendador automático parou.</CardDescription>
                </div>
                 <Button variant="outline" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar para o Log
                </Button>
            </div>
        </CardHeader>
      </Card>

       <Card>
            <CardContent className="pt-6 overflow-auto">
                {allMatches.length > 0 ? (
                    <div className="min-w-[800px]">
                        <div className="grid grid-cols-1" style={{ gridTemplateColumns: `60px repeat(${courts.length}, 1fr)`}}>
                            <div className="sticky top-0 bg-background z-10"></div>
                            {courts.map(court => (
                                <div key={court.name} className="text-center font-bold p-2 sticky top-0 bg-background z-10 border-b">
                                    {court.name}
                                </div>
                            ))}
                            
                            {timeSlots.map(slot => (
                                <React.Fragment key={slot.time}>
                                    <div className="flex items-center justify-center font-mono text-sm text-muted-foreground border-r">
                                        {slot.time}
                                    </div>
                                    {slot.courts.map(court => {
                                        const isCourtInService = courts.find(c => c.name === court.name)?.slots
                                            .some(s => {
                                                if (!globalSettings) return false;
                                                const slotStart = parseTime(s.startTime);
                                                const slotEnd = parseTime(s.endTime);
                                                const matchEnd = addMinutes(slot.datetime, globalSettings.estimatedMatchDuration || 20);
                                                return slot.datetime >= slotStart && matchEnd <= slotEnd;
                                            });

                                        return (
                                            <div key={court.name} className={cn(
                                                "border-r border-b p-1 min-h-[100px] flex items-center justify-center",
                                                !isCourtInService && "bg-muted/50"
                                            )}>
                                                {isCourtInService && court.match && <MatchCard match={court.match} />}
                                            </div>
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                ) : (
                     <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg min-h-[200px]">
                        <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-semibold">Nenhum Snapshot para Exibir</h3>
                        <p className="text-muted-foreground">
                            Execute o agendador e, se houver falhas, um snapshot será gerado aqui.
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    </div>
  );
}
