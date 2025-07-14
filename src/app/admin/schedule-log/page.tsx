
"use client";

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, FileText, ArrowLeft, Clock, User, Users } from 'lucide-react';
import type { SchedulingLog } from '@/lib/scheduler';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export default function ScheduleLogPage() {
    const [logs, setLogs] = React.useState<SchedulingLog[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const router = useRouter();

    React.useEffect(() => {
        try {
            const storedLogs = sessionStorage.getItem('schedulingLogs');
            if (storedLogs) {
                setLogs(JSON.parse(storedLogs));
            }
        } catch (error) {
            console.error("Could not access sessionStorage or parse logs:", error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    if (isLoading) {
        return null;
    }
    
    const hasLogs = logs.length > 0;

    return (
        <div className="flex flex-col gap-8">
            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center">
                        <FileText className="mr-2 h-8 w-8" />
                        Log do Agendamento
                    </h1>
                    <p className="text-muted-foreground">
                        Detalhes sobre por que algumas partidas não puderam ser agendadas.
                    </p>
                </div>
                <Button variant="outline" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            {hasLogs ? (
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {logs.map((log) => (
                        <Card key={log.matchId} className="flex flex-col">
                            <CardHeader>
                                <CardTitle className="text-base font-bold truncate">
                                    {log.team1} vs {log.team2}
                                </CardTitle>
                                <CardDescription className="text-xs">
                                   ID: {log.matchId}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex-grow space-y-4">
                                <div className='space-y-1'>
                                    <h4 className="text-sm font-semibold">Detalhes da Partida</h4>
                                     <div className="flex items-center text-sm text-muted-foreground">
                                        <Users className="mr-2 h-4 w-4" />
                                        <span>{log.category} - {log.stage}</span>
                                    </div>
                                </div>
                                <Separator />
                                <div className="space-y-2">
                                     <h4 className="text-sm font-semibold">Motivos da Não Alocação</h4>
                                     <ul className="list-disc list-inside space-y-1 text-sm">
                                        {log.reasons.map((reason, index) => (
                                            <li key={index} className="text-destructive">{reason}</li>
                                        ))}
                                    </ul>
                                </div>
                            </CardContent>
                            <CardFooter>
                                <Badge variant="destructive">Não Alocado</Badge>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            ) : (
                <Card className="min-h-[400px]">
                     <CardContent className="flex flex-col items-center justify-center h-full text-center p-8">
                        <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-semibold">Nenhum Log Encontrado</h3>
                        <p className="text-muted-foreground">
                            Não há logs de agendamento disponíveis ou a última execução foi bem-sucedida.
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
