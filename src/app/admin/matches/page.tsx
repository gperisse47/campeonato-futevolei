
"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Swords, AlertCircle, CalendarClock, GripVertical, Sparkles, PlusCircle, FileText, Download, Upload, Trash2, FileWarning } from "lucide-react";
import type { PlayoffBracket, PlayoffBracketSet, CategoryData, TournamentsState, Court, MatchWithScore, PlayoffMatch, Team, GlobalSettings } from "@/lib/types";
import { getTournaments, updateMultipleMatches, generateScheduleAction, clearAllSchedules, importScheduleFromCSV } from "@/app/actions";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { format, parse, addMinutes, isWithinInterval, startOfDay, isBefore } from 'date-fns';
import { cn } from "@/lib/utils";
import { LoginPage } from "@/components/login-page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import jsPDF from "jspdf";
import type { SchedulingLog } from "@/lib/scheduler";
import Papa from 'papaparse';


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

// Extracts dependencies from a placeholder string
function extractDependencies(placeholder: string | undefined, categoryName: string): { matchDeps: string[], groupDeps: string[] } {
    const deps = { matchDeps: [] as string[], groupDeps: [] as string[] };
    if (!placeholder) return deps;
    
    // For "Vencedor Categoria-QuartasdeFinal-Jogo1" or "Perdedor Categoria-U-R1-J1"
    const matchDepMatch = placeholder.match(/(?:Vencedor|Perdedor)\s(.+)/);
    if (matchDepMatch && matchDepMatch[1]) {
        deps.matchDeps.push(matchDepMatch[1].trim());
        return deps;
    }
    
    // For "1º do MistoAvançado-GroupA"
    const groupDepMatch = placeholder.match(/\d+º\sdo\s(.+)/);
    if (groupDepMatch && groupDepMatch[1]) {
        // We add the category name to ensure uniqueness across categories
        const groupIdentifier = `${categoryName.replace(/\s/g, '')}-${groupDepMatch[1].replace(/\s/g, '')}`;
        deps.groupDeps.push(groupIdentifier);
    }

    return deps;
}


export default function ScheduleGridPage() {
  const [allMatches, setAllMatches] = useState<SchedulableMatch[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const router = useRouter();

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const savedTournaments = await getTournaments();
      const { _globalSettings } = savedTournaments;
      
      setGlobalSettings(_globalSettings);
      const loadedCourts = _globalSettings.courts || [];
      setCourts(loadedCourts);

      const loadedMatches: Omit<SchedulableMatch, 'dependencies'>[] = [];
      const groupMatchMap = new Map<string, string[]>(); // Map group name to match IDs

       for (const categoryName in savedTournaments) {
          if (categoryName === '_globalSettings') continue;
          const categoryData = savedTournaments[categoryName] as CategoryData;

          const addMatches = (matches: (MatchWithScore | PlayoffMatch)[], stageOverride?: string, isGroup: boolean = false) => {
              matches.forEach(match => {
                  if (!match.id) return;
                  const t1Name = teamName(match.team1, match.team1Placeholder);
                  const t2Name = teamName(match.team2, match.team2Placeholder);
                  
                   if (isGroup && stageOverride) {
                     const groupIdentifier = `${categoryName.replace(/\s/g, '')}-${stageOverride.replace(/\s/g, '')}`;
                     if (!groupMatchMap.has(groupIdentifier)) {
                        groupMatchMap.set(groupIdentifier, []);
                     }
                     groupMatchMap.get(groupIdentifier)!.push(match.id);
                  }

                  const schedulableMatch = {
                    ...match,
                    id: match.id,
                    category: categoryName,
                    stage: stageOverride || ('name' in match ? match.name : categoryName),
                    team1Name: t1Name,
                    team2Name: t2Name,
                    players: [] as string[],
                    isGroupMatch: isGroup,
                  };
                  schedulableMatch.players = getPlayersFromMatch(schedulableMatch as SchedulableMatch);
                  loadedMatches.push(schedulableMatch);
              });
          };

          categoryData.tournamentData?.groups.forEach(group => addMatches(group.matches, group.name, true));
          
           if (categoryData.playoffs) {
                const processBracket = (bracket?: PlayoffBracket) => {
                    if (!bracket) return;
                    Object.values(bracket).flat().forEach(match => {
                         if (!match.id) return;
                        addMatches([match], undefined, false);
                    });
                };
                
                const playoffs = categoryData.playoffs as PlayoffBracketSet;
                if (playoffs.upper || playoffs.lower || playoffs.playoffs) {
                    processBracket(playoffs.upper);
                    processBracket(playoffs.lower);
                    processBracket(playoffs.playoffs);
                } else {
                    processBracket(playoffs as PlayoffBracket);
                }
            }
      }

      // Now add dependencies
        const matchesWithDependencies: SchedulableMatch[] = loadedMatches.map(match => {
            const deps = new Set<string>();
            if (!match.isGroupMatch) {
                const { matchDeps: t1MatchDeps, groupDeps: t1GroupDeps } = extractDependencies(match.team1Placeholder, match.category);
                const { matchDeps: t2MatchDeps, groupDeps: t2GroupDeps } = extractDependencies(match.team2Placeholder, match.category);

                t1MatchDeps.forEach(d => deps.add(d));
                t2MatchDeps.forEach(d => deps.add(d));
                
                t1GroupDeps.forEach(groupDep => {
                    groupMatchMap.get(groupDep)?.forEach(matchId => deps.add(matchId));
                });
                t2GroupDeps.forEach(groupDep => {
                    groupMatchMap.get(groupDep)?.forEach(matchId => deps.add(matchId));
                });
            }
            return {
                ...match,
                dependencies: Array.from(deps)
            } as SchedulableMatch;
        });

      setAllMatches(matchesWithDependencies);

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
                if (courtInSlot && !courtInSlot.match) { // Check if slot is empty
                    courtInSlot.match = match;
                } else if (courtInSlot) {
                    console.warn(`Slot conflict at ${slot.time} on ${match.court}. Match ${match.id} not placed.`);
                }
            }
        }
    });
    setTimeSlots(newTimeSlots);
  }, [courts, allMatches, globalSettings]);

  const handleMoveMatch = async (matchId: string, newTime: string, newCourt: string) => {
      const matchToMove = allMatches.find(m => m.id === matchId);
      if (!matchToMove) return;
      
      setIsSaving(true);
      const result = await updateMultipleMatches([{
          matchId: matchToMove.id,
          categoryName: matchToMove.category,
          time: newTime,
          court: newCourt
      }]);

      if (result.success) {
          toast({ title: "Jogo movido com sucesso!" });
          await loadData();
      } else {
          toast({ variant: "destructive", title: "Erro ao mover jogo", description: result.error });
      }
      setIsSaving(false);
  };
  
  const handleUnscheduleMatch = async (matchId: string) => {
      const matchToUnschedule = allMatches.find(m => m.id === matchId);
      if (!matchToUnschedule) return;

      setIsSaving(true);
      const result = await updateMultipleMatches([{
          matchId: matchToUnschedule.id,
          categoryName: matchToUnschedule.category,
          time: '',
          court: ''
      }]);
       if (result.success) {
          toast({ title: "Jogo removido do agendamento!" });
          await loadData();
      } else {
          toast({ variant: "destructive", title: "Erro ao remover jogo", description: result.error });
      }
      setIsSaving(false);
  }

  const handleShowLog = (logs: SchedulingLog[], partialSchedule?: any[]) => {
      try {
        sessionStorage.setItem('schedulingLogs', JSON.stringify(logs));
        if (partialSchedule) {
            sessionStorage.setItem('partialSchedule', JSON.stringify(partialSchedule));
        } else {
            sessionStorage.removeItem('partialSchedule');
        }
        router.push('/admin/schedule-log');
      } catch (error) {
          toast({
            variant: "destructive",
            title: "Erro ao exibir log",
            description: "Não foi possível abrir a página de logs.",
          });
      }
  };

  const handleGenerateSchedule = async () => {
    setIsSaving(true);
    const result = await generateScheduleAction();
    if (result.success) {
        toast({ title: "Horários gerados com sucesso!", description: "A grade foi atualizada."});
        await loadData();
    } else {
        toast({ 
            variant: "destructive",
            title: "Erro ao gerar horários", 
            description: result.error,
            action: result.logs && (
                <Button variant="secondary" size="sm" onClick={() => handleShowLog(result.logs!, result.partialSchedule)}>
                    Ver Log de Erros
                </Button>
            ),
            duration: 10000,
        });
    }
    setIsSaving(false);
  };

  const handleClearSchedule = async () => {
    setIsSaving(true);
    const result = await clearAllSchedules();
    if (result.success) {
        toast({ title: "Agendamento limpo!", description: "Todos os horários e quadras foram removidos."});
        await loadData();
    } else {
        toast({ variant: "destructive", title: "Erro ao limpar", description: result.error });
    }
    setIsSaving(false);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsSaving(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
        const csvData = e.target?.result as string;
        const result = await importScheduleFromCSV(csvData);
        if (result.success) {
            toast({ title: "Horários importados com sucesso!" });
            await loadData();
        } else {
            toast({ variant: "destructive", title: "Erro na importação", description: result.error });
        }
        setIsSaving(false);
    };
    reader.readAsText(file);
    // Reset file input
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
  };

  const handleExportCSV = () => {
    const scheduledMatches = allMatches.filter(m => m.time && m.court);
    if (scheduledMatches.length === 0) {
        toast({
            variant: "destructive",
            title: "Nenhum Jogo Agendado",
            description: "Não há jogos na grade para exportar.",
        });
        return;
    }
    const csvData = Papa.unparse(
      scheduledMatches.map(m => ({
        matchId: m.id,
        category: m.category,
        stage: m.stage,
        team1: m.team1Name,
        team2: m.team2Name,
        time: m.time,
        court: m.court,
      }))
    );

    const blob = new Blob([`\uFEFF${csvData}`], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "grade_horarios.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPDF = () => {
    if (!courts.length || !timeSlots.length) return;

    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(10);
    const margin = 10;
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const contentWidth = pageWidth - 2 * margin;

    const allColumns = ["Horário", ...courts.map((c) => c.name)];
    const colCount = allColumns.length;
    const colWidth = contentWidth / colCount;
    const rowHeight = 15;
    let yPos = margin + 20;

    // Title
    doc.setFontSize(18);
    doc.setTextColor("#4682B4");
    const title = "Grade de Horários do Torneio";
    const titleWidth = doc.getStringUnitWidth(title) * doc.getFontSize() / doc.internal.scaleFactor;
    doc.text(title, (pageWidth - titleWidth) / 2, margin + 5);
    
    // Header
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setFillColor("#4682B4");
    doc.setTextColor("#FFFFFF");
    doc.rect(margin, yPos, contentWidth, 10, "F");
    allColumns.forEach((col, index) => {
        doc.text(col, margin + index * colWidth + colWidth / 2, yPos + 7, { align: 'center' });
    });
    yPos += 10;
    
    // Rows
    doc.setFont("helvetica", "normal");
    doc.setTextColor("#000000");

    timeSlots.forEach((slot, rowIndex) => {
        if (yPos + rowHeight > pageHeight - margin) {
            doc.addPage();
            yPos = margin;
        }

        const fillColor = rowIndex % 2 === 0 ? "#F5F5F5" : "#FFFFFF";
        doc.setFillColor(fillColor);
        doc.rect(margin, yPos, contentWidth, rowHeight, "F");
        
        // Time cell
        doc.text(slot.time, margin + colWidth / 2, yPos + rowHeight / 2 + 3, { align: 'center' });

        // Match cells
        slot.courts.forEach((courtSlot, colIndex) => {
            const cellX = margin + (colIndex + 1) * colWidth;
            if (courtSlot.match) {
                const match = courtSlot.match;
                const textLines = [
                    match.stage || '',
                    match.team1Name || '',
                    'vs',
                    match.team2Name || ''
                ];
                
                doc.setFontSize(8);
                const lineHeight = 4;
                const totalTextHeight = textLines.length * lineHeight;
                let textY = yPos + (rowHeight - totalTextHeight) / 2 + lineHeight;

                textLines.forEach(line => {
                    doc.text(line, cellX + colWidth / 2, textY, { align: 'center' });
                    textY += lineHeight;
                });
            }
        });

        yPos += rowHeight;
    });

    doc.save("grade_horarios.pdf");
  };


  const unscheduledMatches = useMemo(() => {
    return allMatches.filter(m => !m.time || !m.court);
  }, [allMatches]);

  const availableSlots = useMemo(() => {
      const slots: { time: string, court: string }[] = [];
      if (!globalSettings) return slots;
      
      timeSlots.forEach(ts => {
          ts.courts.forEach(c => {
              const isCourtInService = courts.find(court => court.name === c.name)?.slots
                  .some(slot => {
                    const slotStart = parseTime(slot.startTime);
                    const slotEnd = parseTime(slot.endTime);
                    const matchEnd = addMinutes(ts.datetime, globalSettings.estimatedMatchDuration || 20);
                    return ts.datetime >= slotStart && matchEnd <= slotEnd;
                  });

              if (isCourtInService && !c.match) {
                  slots.push({ time: ts.time, court: c.name });
              }
          });
      });
      return slots;
  }, [timeSlots, courts, globalSettings]);

  const scheduledMatchesMap = useMemo(() => {
    const map = new Map<string, SchedulableMatch>();
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

  const MatchCard = ({ match }: { match: SchedulableMatch }) => {
    const playerConflicts = timeSlots.find(ts => ts.time === match.time)
        ?.courts.filter(c => c.match && c.match.id !== match.id)
        .flatMap(c => c.match!.players)
        .filter(p => match.players.includes(p)) ?? [];
    
    let scheduleConflict = false;
    if (match.time) {
        const matchTime = parseTime(match.time);
        
        // Check "backward": is this match scheduled before a dependency?
        for (const depId of match.dependencies) {
            const depMatch = scheduledMatchesMap.get(depId);
            if (depMatch?.time && isBefore(matchTime, parseTime(depMatch.time))) {
                scheduleConflict = true;
                break;
            }
        }
        
        // Check "forward": is another match that depends on this one scheduled earlier?
        if (!scheduleConflict) {
            for (const otherMatch of allMatches) {
                if (otherMatch.time && otherMatch.dependencies.includes(match.id)) {
                     if (isBefore(parseTime(otherMatch.time), matchTime)) {
                        scheduleConflict = true;
                        break;
                    }
                }
            }
        }
    }

    const hasConflict = playerConflicts.length > 0 || scheduleConflict;

    return (
        <Card className={cn("p-2 text-xs relative group h-full flex flex-col justify-center", hasConflict && "bg-destructive/20 border-destructive")}>
             <div className="font-bold text-center truncate">{match.category} - {match.stage}</div>

             <div className="text-muted-foreground mb-0.5 truncate text-center">{match.team1Name}</div>
             <div className="text-muted-foreground my-0.5 text-center">vs</div>
             <div className="text-muted-foreground mb-0.5 truncate text-center">{match.team2Name}</div>
              {hasConflict && (
                <div className="absolute -top-2 -right-2">
                    <AlertCircle className="h-5 w-5 text-destructive-foreground bg-destructive rounded-full p-0.5" />
                </div>
            )}
             <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Select onValueChange={(value) => {
                    if (value === 'unschedule') {
                        handleUnscheduleMatch(match.id);
                    } else {
                        const [newTime, newCourt] = value.split('|');
                        handleMoveMatch(match.id, newTime, newCourt);
                    }
                }}>
                    <SelectTrigger className="h-6 w-6 p-1 bg-background/80">
                       <GripVertical className="h-4 w-4" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="unschedule">Remover do Horário</SelectItem>
                        {availableSlots.map(slot => (
                            <SelectItem key={`${slot.time}-${slot.court}`} value={`${slot.time}|${slot.court}`}>
                                Mover para {slot.time} - {slot.court}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
             </div>
        </Card>
    );
  };


  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
             <CardTitle className="flex items-center"><CalendarClock className="mr-2"/>Grade de Horários</CardTitle>
             <CardDescription>Visualize, mova os jogos e gere horários automaticamente.</CardDescription>
             <div className="flex flex-wrap gap-2 pt-4">
                <Button onClick={() => fileInputRef.current?.click()}>
                    <Upload className="mr-2 h-4 w-4"/>
                    Importar CSV
                </Button>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv" className="hidden" />

                <Button onClick={handleExportCSV}><Download className="mr-2 h-4 w-4"/>Exportar CSV</Button>
                
                <Button onClick={handleExportPDF}><FileText className="mr-2 h-4 w-4"/>Exportar PDF</Button>

                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button>
                          <Trash2 className="mr-2 h-4 w-4"/>
                          Limpar Agendamento
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                        <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta ação removerá todos os horários e quadras de todos os jogos. A lista de jogos não será afetada.
                        </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleClearSchedule}>Limpar</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button disabled={isSaving}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Sparkles className="mr-2 h-4 w-4"/>}
                            Gerar Horários
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                        <AlertDialogTitle>Gerar Horários Automaticamente?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta ação irá apagar o agendamento atual e gerar um novo para todos os jogos, otimizando o uso das quadras e o descanso dos jogadores. Isso pode levar alguns segundos.
                        </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleGenerateSchedule}>Gerar</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
             </div>
        </CardHeader>
      </Card>
      
      <div className="flex flex-col gap-4">
        <Card>
            <CardContent className="pt-6 overflow-auto">
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
                                            {isCourtInService && !court.match && (
                                            <Select onValueChange={(matchId) => handleMoveMatch(matchId, slot.time, court.name)}>
                                                <SelectTrigger className="h-8 w-8 p-0 border-dashed bg-transparent shadow-none">
                                                    <PlusCircle className="h-5 w-5 text-muted-foreground" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        {unscheduledMatches.map(m => (
                                                            <SelectItem key={m.id} value={m.id}>
                                                                {m.team1Name} vs {m.team2Name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectGroup>
                                                </SelectContent>
                                            </Select>
                                            )}
                                        </div>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
        <Card>
            <CardHeader>
                <CardTitle>Jogos Não Agendados</CardTitle>
                <CardDescription>{unscheduledMatches.length} jogos a serem agendados.</CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="max-h-48 pr-4">
                    <div className="space-y-2">
                    {unscheduledMatches.map(match => (
                        <Card key={match.id} className="p-2 text-xs flex items-center gap-2">
                            <div>
                            <div className="font-bold truncate">{match.category} - {match.stage}</div>
                                <div className="text-muted-foreground my-0.5 text-center">{match.team1Name}</div>
                                <div className="text-muted-foreground my-0.5 text-center">vs</div>
                                <div className="text-muted-foreground my-0.5 text-center">{match.team2Name}</div>
                            </div>
                            <Select onValueChange={(value) => {
                                const [newTime, newCourt] = value.split('|');
                                handleMoveMatch(match.id, newTime, newCourt);
                            }}>
                                <SelectTrigger className="w-28 h-8 text-xs">
                                    <SelectValue placeholder="Agendar..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableSlots.map(slot => (
                                        <SelectItem key={`${slot.time}-${slot.court}`} value={`${slot.time}|${slot.court}`}>
                                            {slot.time} - {slot.court}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Card>
                    ))}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
      </div>
    </div>
  );
}

    

    

    

    