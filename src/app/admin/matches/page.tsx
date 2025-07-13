
"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, Swords, AlertCircle, CalendarClock, GripVertical, Sparkles, PlusCircle, FileText } from "lucide-react";
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
import autoTable from "jspdf-autotable";


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
    while (currentTime <= latestTime) {
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

  const handleGenerateSchedule = async () => {
    setIsSaving(true);
    const result = await generateScheduleAction();
    if (result.success) {
        toast({ title: "Horários gerados com sucesso!", description: "A grade foi atualizada."});
        await loadData();
    } else {
        toast({ variant: "destructive", title: "Erro ao gerar horários", description: result.error });
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

  const handleExportPDF = () => {
    if (!courts.length || !timeSlots.length) return;

    const doc = new jsPDF({ orientation: "landscape" });

    const primaryColor = "#FF8C00";
    const headerColor = "#4682B4";
    const mutedTextColor = "#777";

    doc.setFontSize(18);
    doc.setTextColor(primaryColor);
    const title = "Grade de Horários do Torneio";
    const titleWidth = doc.getStringUnitWidth(title) * doc.getFontSize() / doc.internal.scaleFactor;
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.text(title, (pageWidth - titleWidth) / 2, 15);

    const head = [["Horário", ...courts.map((c) => c.name)]];

    const body = timeSlots.map((slot) => {
        const rowData = [
            slot.time,
            ...slot.courts.map((courtSlot) => courtSlot.match || ""),
        ];
        return rowData;
    });

    autoTable(doc, {
        head: head,
        body: body,
        startY: 25,
        theme: "grid",
        headStyles: {
            fillColor: headerColor,
            textColor: "#FFFFFF",
            fontStyle: "bold",
            halign: "center",
        },
        styles: {
            font: "helvetica",
            cellPadding: 2,
            fontSize: 8,
            valign: 'middle',
            halign: 'center',
            minCellHeight: 18,
        },
        alternateRowStyles: {
            fillColor: "#F5F5DC"
        },
        didDrawCell: (data) => {
            let cellContent = data.cell.raw;
            if (typeof cellContent === 'object' && cellContent !== null && 'team1Name' in cellContent) {
                const match = cellContent as SchedulableMatch;
                const doc = data.doc;
                const cell = data.cell;
                
                const originalFontSize = doc.getFontSize();
                const originalFontStyle = doc.getFont().fontStyle;

                const x = cell.x + cell.padding('left');
                const y = cell.y + cell.padding('top');
                const width = cell.width - cell.padding('horizontal');

                // Categoria - Fase (menor)
                doc.setFontSize(originalFontSize - 2);
                doc.setFont(undefined, 'normal');
                doc.text(`${match.category} - ${match.stage}`, x, y + 2, { maxWidth: width, align: 'center' });

                // Dupla 1 (negrito)
                doc.setFontSize(originalFontSize);
                doc.setFont(undefined, 'bold');
                doc.text(match.team1Name, x + width / 2, y + 6, { align: 'center' });

                // vs
                doc.setFontSize(originalFontSize - 1);
                doc.setFont(undefined, 'normal');
                doc.text('vs', x + width / 2, y + 10, { align: 'center' });
                
                // Dupla 2 (negrito)
                doc.setFontSize(originalFontSize);
                doc.setFont(undefined, 'bold');
                doc.text(match.team2Name, x + width / 2, y + 14, { align: 'center' });
                
                // Reset styles
                doc.setFontSize(originalFontSize);
                doc.setFont(undefined, originalFontStyle);
            }
        },
        didDrawPage: (data) => {
            const pageCount = doc.getNumberOfPages();
            doc.setFontSize(8);
            doc.setTextColor(mutedTextColor);
            doc.text(
                `Página ${data.pageNumber} de ${pageCount}`,
                data.settings.margin.left,
                doc.internal.pageSize.getHeight() - 10
            );
        },
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
                  .some(slot => isWithinInterval(ts.datetime, { start: parseTime(slot.startTime), end: addMinutes(parseTime(slot.endTime), -(globalSettings.estimatedMatchDuration || 20)) }));

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
        
        // Check if a prerequisite match is scheduled after the current match
        for (const depId of match.dependencies) {
            const depMatch = scheduledMatchesMap.get(depId);
            if (depMatch?.time && isBefore(matchTime, parseTime(depMatch.time))) {
                scheduleConflict = true;
                break;
            }
        }
        
        // Check if the current match is scheduled before a match that depends on it
        if (!scheduleConflict) {
            for (const otherMatch of allMatches) {
                if (otherMatch.dependencies.includes(match.id) && otherMatch.time) {
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
             <div className="text-muted-foreground mb-1 text-center truncate">{match.category} - {match.stage}</div>
             <div className="font-bold truncate text-center">{match.team1Name}</div>
             <div className="text-muted-foreground my-0.5 text-center">vs</div>
             <div className="font-bold truncate text-center">{match.team2Name}</div>
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
                <Button onClick={() => fileInputRef.current?.click()} variant="outline">Importar CSV</Button>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv" className="hidden" />
                
                <Button onClick={handleExportPDF} variant="outline"><FileText className="mr-2 h-4 w-4"/>Exportar PDF</Button>

                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="outline">Limpar Agendamento</Button>
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
                            <div className="flex-grow">
                                <div className="font-bold truncate">{match.team1Name}</div>
                                <div className="text-muted-foreground my-0.5 text-center">vs</div>
                                <div className="font-bold truncate">{match.team2Name}</div>
                                <div className="text-muted-foreground mt-1 truncate">{match.category} - {match.stage}</div>
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
                                            const intervalEnd = addMinutes(parseTime(s.endTime), -(globalSettings.estimatedMatchDuration || 20));
                                            return isWithinInterval(slot.datetime, { start: parseTime(s.startTime), end: intervalEnd })
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
    </div>
  );
}

    