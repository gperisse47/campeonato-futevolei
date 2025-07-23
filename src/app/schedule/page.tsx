
"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, CalendarClock, AlertCircle } from "lucide-react";
import type { PlayoffBracket, PlayoffBracketSet, CategoryData, Court, MatchWithScore, PlayoffMatch, Team, GlobalSettings } from "@/lib/types";
import { getTournaments } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";
import { format, parse, addMinutes, isBefore, startOfDay } from 'date-fns';
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { FileText } from "lucide-react";

type SchedulableMatch = (MatchWithScore | PlayoffMatch) & {
  id: string;
  category: string;
  players: string[];
  team1Name: string;
  team2Name: string;
  stage: string;
  dependencies: string[];
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


export default function ScheduleGridPage() {
  const [allMatches, setAllMatches] = useState<SchedulableMatch[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);

  const loadData = useCallback(async () => {
    // No setIsLoading(true) here to avoid flicker on interval refresh
    try {
      const savedTournaments = await getTournaments();
      const { _globalSettings } = savedTournaments;
      
      setGlobalSettings(_globalSettings);
      const loadedCourts = _globalSettings.courts || [];
      setCourts(loadedCourts);

      const loadedMatches: SchedulableMatch[] = [];

       for (const categoryName in savedTournaments) {
          if (categoryName === '_globalSettings') continue;
          const categoryData = savedTournaments[categoryName] as CategoryData;

          const addMatches = (matches: (MatchWithScore | PlayoffMatch)[], stageOverride?: string) => {
              matches.forEach(match => {
                  if (!match.id) return;
                  const t1Name = teamName(match.team1, match.team1Placeholder);
                  const t2Name = teamName(match.team2, match.team2Placeholder);

                  const schedulableMatch = {
                    ...match,
                    id: match.id,
                    category: categoryName,
                    stage: stageOverride || ('name' in match ? match.name : categoryName),
                    team1Name: t1Name,
                    team2Name: t2Name,
                    players: [] as string[],
                    dependencies: [] // Dependencies not needed for public view logic
                  };
                  loadedMatches.push(schedulableMatch);
              });
          };

          categoryData.tournamentData?.groups.forEach(group => addMatches(group.matches, group.name));
          
           if (categoryData.playoffs) {
                const processBracket = (bracket?: PlayoffBracket) => {
                    if (!bracket) return;
                    Object.values(bracket).flat().forEach(match => {
                         if (!match.id) return;
                        addMatches([match]);
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
      setAllMatches(loadedMatches);

    } catch (error) {
      console.error("Failed to load data", error);
      toast({ variant: "destructive", title: "Erro ao Carregar Dados" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);
  
  useEffect(() => {
    loadData();
    const intervalId = setInterval(loadData, 5000); // Refresh every 5 seconds
    return () => clearInterval(intervalId);
  }, [loadData]);


  useEffect(() => {
    if (!courts.length || !globalSettings) return;

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

  const handleExportPDF = () => {
    if (!courts.length || !timeSlots.length) return;

    const doc = new jsPDF({ orientation: "landscape" });
    const margin = 10;
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const contentWidth = pageWidth - 2 * margin;

    const allColumns = ["Horário", ...courts.map((c) => c.name)];
    const colCount = allColumns.length;
    const colWidth = contentWidth / colCount;
    const rowHeight = 25; // Increased row height
    const lineHeight = 5;
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
    timeSlots.forEach((slot, rowIndex) => {
        if (yPos + rowHeight > pageHeight - margin) {
            doc.addPage();
            yPos = margin;
            // Redraw header on new page
            doc.setFont("helvetica", "bold");
            doc.setFillColor("#4682B4");
            doc.setTextColor("#FFFFFF");
            doc.rect(margin, yPos, contentWidth, 10, "F");
            allColumns.forEach((col, index) => {
                doc.text(col, margin + index * colWidth + colWidth / 2, yPos + 7, { align: 'center' });
            });
            yPos += 10;
        }

        const baseFillColor = rowIndex % 2 === 0 ? "#F5F5F5" : "#FFFFFF";

        // Time cell
        doc.setFillColor(baseFillColor);
        doc.rect(margin, yPos, colWidth, rowHeight, "F");
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor("#000000");
        doc.text(slot.time, margin + colWidth / 2, yPos + rowHeight / 2 + 3, { align: 'center' });

        // Match cells
        slot.courts.forEach((courtSlot, colIndex) => {
            const cellX = margin + (colIndex + 1) * colWidth;
            doc.setFillColor(baseFillColor);
            doc.rect(cellX, yPos, colWidth, rowHeight, "F");

            if (courtSlot.match) {
                const match = courtSlot.match;
                const info = `${match.category} - ${match.stage}`;
                const team1 = match.team1Name || '';
                const vs = (match.score1 !== undefined && match.score2 !== undefined) ? `${match.score1} x ${match.score2}` : 'vs';
                const team2 = match.team2Name || '';

                const totalTextHeight = 4 * lineHeight;
                let textY = yPos + (rowHeight - totalTextHeight) / 2 + lineHeight;

                doc.setFontSize(7);
                doc.setFont('helvetica', 'bold');
                doc.text(info, cellX + colWidth / 2, textY, { align: 'center' });
                
                textY += lineHeight;
                doc.setFontSize(7);
                doc.setFont('helvetica', 'normal');
                doc.text(team1, cellX + colWidth / 2, textY, { align: 'center' });
                
                textY += lineHeight;
                doc.setFontSize(6);
                doc.setFont('helvetica', 'normal');
                doc.text(vs, cellX + colWidth / 2, textY, { align: 'center' });
                
                textY += lineHeight;
                doc.setFont('helvetica', 'normal');
                doc.text(team2, cellX + colWidth / 2, textY, { align: 'center' });
            }
        });

        yPos += rowHeight;
    });

    doc.save("grade_horarios.pdf");
  };

  if (isLoading) {
    return <div className="flex h-screen w-full items-center justify-center"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  const MatchCard = ({ match }: { match: SchedulableMatch }) => {
    return (
        <Card className="p-2 text-xs relative group h-full flex flex-col justify-center">
             <div className="font-bold text-center truncate">{match.category} - {match.stage}</div>
             
             {match.score1 !== undefined && match.score2 !== undefined ? (
                 <>
                    <div className="text-muted-foreground mb-0.5 truncate text-center">{match.team1Name}</div>
                    <div className="font-bold my-0.5 text-center text-sm">{`${match.score1} x ${match.score2}`}</div>
                    <div className="text-muted-foreground mb-0.5 truncate text-center">{match.team2Name}</div>
                 </>
             ) : (
                 <>
                    <div className="text-muted-foreground mb-0.5 truncate text-center">{match.team1Name}</div>
                    <div className="text-muted-foreground my-0.5 text-center">vs</div>
                    <div className="text-muted-foreground mb-0.5 truncate text-center">{match.team2Name}</div>
                </>
             )}
        </Card>
    );
  };


  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
             <CardTitle className="flex items-center"><CalendarClock className="mr-2"/>Grade de Horários</CardTitle>
             <CardDescription>Visualize a programação completa do torneio, com horários, quadras e resultados ao vivo.</CardDescription>
              <div className="flex flex-wrap gap-2 pt-4">
                 <Button onClick={handleExportPDF}><FileText className="mr-2 h-4 w-4"/>Exportar PDF</Button>
              </div>
        </CardHeader>
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
          </CardContent>
      </Card>
    </div>
  );
}
