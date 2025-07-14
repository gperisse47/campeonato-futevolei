
"use client";

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AlertTriangle, FileText, ArrowLeft, Info } from 'lucide-react';
import type { SchedulingLog } from '@/lib/scheduler';
import { Badge } from '@/components/ui/badge';

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

            <Card>
                <CardHeader>
                    <CardTitle>Partidas Não Alocadas</CardTitle>
                    <CardDescription>
                        A tabela abaixo detalha cada partida que não pôde ser agendada e os motivos.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {hasLogs ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Duplas Envolvidas</TableHead>
                                    <TableHead>Categoria / Fase</TableHead>
                                    <TableHead>Motivos da Falha</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {logs.map((log) => (
                                    <TableRow key={log.matchId}>
                                        <TableCell className="font-medium">
                                            <div className="font-bold">{log.team1}</div>
                                            <div className="text-xs text-muted-foreground my-1">vs</div>
                                            <div className="font-bold">{log.team2}</div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="font-semibold">{log.category}</div>
                                            <div className="text-sm text-muted-foreground">{log.stage}</div>
                                        </TableCell>
                                        <TableCell>
                                            <ul className="list-disc list-inside space-y-1 text-sm">
                                                {log.reasons.map((reason, index) => (
                                                    <li key={index} className="text-destructive flex items-start gap-2">
                                                        <Info className="h-4 w-4 mt-0.5 shrink-0" />
                                                        <span>{reason}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-lg min-h-[200px]">
                            <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
                            <h3 className="text-lg font-semibold">Nenhum Log Encontrado</h3>
                            <p className="text-muted-foreground">
                                Não há logs de agendamento disponíveis ou a última execução foi bem-sucedida.
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
