
"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { getTournamentByCategory } from "@/app/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Loader2, Trophy } from "lucide-react";
import type { CategoryData, PlayoffBracket, PlayoffMatch, Team, GroupWithScores } from "@/lib/types";

const roundNames: { [key: number]: string } = {
    2: 'Final',
    4: 'Semifinal',
    8: 'Quartas de Final',
    16: 'Oitavas de Final'
};

const teamToKey = (team: Team) => `${team.player1} e ${team.player2}`;

const PlayoffMatchCard = ({ match, roundName, isFinalRound }: { match: PlayoffMatch, roundName: string, isFinalRound: boolean }) => {
    const getWinner = (m: PlayoffMatch) => {
        if (m.score1 === undefined || m.score2 === undefined || m.score1 === m.score2) return null;
        return m.score1 > m.score2 ? m.team1 : m.team2;
    }

    const winnerTeam = getWinner(match);
    const winnerKey = winnerTeam ? teamToKey(winnerTeam) : null;

    const team1Key = match.team1 ? teamToKey(match.team1) : null;
    const team2Key = match.team2 ? teamToKey(match.team2) : null;

    const placeholder1 = match.team1Placeholder.replace(/Vencedor Semifinal-?(\d)/, 'Vencedor Semifinal $1').replace(/Perdedor Semifinal-?(\d)/, 'Perdedor Semifinal $1');
    const placeholder2 = match.team2Placeholder.replace(/Vencedor Semifinal-?(\d)/, 'Vencedor Semifinal $1').replace(/Perdedor Semifinal-?(\d)/, 'Perdedor Semifinal $1');

    return (
        <div className="flex flex-col gap-2 w-full">
            {(!isFinalRound || (isFinalRound && roundName !== 'Final' && roundName !== 'Disputa de 3º Lugar')) && <h4 className="text-sm font-semibold text-center text-muted-foreground whitespace-nowrap">{match.name}</h4>}
            <div className={`p-2 rounded-md space-y-2 ${isFinalRound ? 'max-w-md' : 'max-w-sm'} w-full mx-auto`}>
                <div className={`flex items-center w-full p-2 rounded-md ${winnerKey && team1Key && winnerKey === team1Key ? 'bg-green-100 dark:bg-green-900/30' : 'bg-secondary/50'}`}>
                    <span className={`text-left truncate pr-2 text-sm ${isFinalRound ? 'w-full' : 'flex-1'}`}>{match.team1 ? teamToKey(match.team1) : placeholder1}</span>
                    <span className="h-8 w-14 shrink-0 text-center font-bold flex items-center justify-center">{match.score1 ?? '0'}</span>
                </div>
                <div className="text-muted-foreground text-xs text-center py-1">vs</div>
                <div className={`flex items-center w-full p-2 rounded-md ${winnerKey && team2Key && winnerKey === team2Key ? 'bg-green-100 dark:bg-green-900/30' : 'bg-secondary/50'}`}>
                    <span className={`text-left truncate pr-2 text-sm ${isFinalRound ? 'w-full' : 'flex-1'}`}>{match.team2 ? teamToKey(match.team2) : placeholder2}</span>
                    <span className="h-8 w-14 shrink-0 text-center font-bold flex items-center justify-center">{match.score2 ?? '0'}</span>
                </div>
            </div>
        </div>
    );
};

const Bracket = ({ playoffs }: { playoffs: PlayoffBracket }) => {
    const roundOrder = Object.keys(roundNames)
        .map(Number)
        .sort((a, b) => b - a)
        .map(key => roundNames[key])
        .filter(roundName => playoffs[roundName]);

    return (
        <div className="flex flex-col items-center w-full overflow-x-auto p-4 gap-8">
            {roundOrder.map(roundName => (
                <Card key={roundName} className="w-full max-w-lg">
                    <CardHeader>
                        <CardTitle className="text-lg font-bold text-primary">{roundName}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-8 w-full">
                        {playoffs[roundName].map((match, matchIndex) => (
                            <PlayoffMatchCard
                                key={match.id}
                                match={match}
                                roundName={roundName}
                                isFinalRound={roundName === 'Final'}
                            />
                        ))}
                    </CardContent>
                </Card>
            ))}
            {playoffs['Final'] && (
                <Card className="w-full max-w-lg">
                    <CardHeader>
                        <CardTitle className="text-lg font-bold text-primary">Final</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <PlayoffMatchCard
                            match={playoffs['Final'][0]}
                            roundName="Final"
                            isFinalRound={true}
                        />
                    </CardContent>
                </Card>
            )}
            {playoffs['Disputa de 3º Lugar'] && (
                <Card className="w-full max-w-lg">
                    <CardHeader>
                        <CardTitle className="text-lg font-bold text-primary">Disputa de 3º Lugar</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <PlayoffMatchCard
                            match={playoffs['Disputa de 3º Lugar'][0]}
                            roundName="Disputa de 3º Lugar"
                            isFinalRound={true}
                        />
                    </CardContent>
                </Card>
            )}
        </div>
    );
};


const GroupCard = ({ group, teamsPerGroupToAdvance }: { group: GroupWithScores, teamsPerGroupToAdvance: number }) => (
    <Card className="flex flex-col">
        <CardHeader>
            <CardTitle className="text-primary">{group.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col space-y-4">
            <div>
                <h4 className="mb-2 font-semibold">Classificação</h4>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="p-2">Dupla</TableHead>
                            <TableHead className="p-2 text-center">Pts</TableHead>
                            <TableHead className="p-2 text-center">J</TableHead>
                            <TableHead className="p-2 text-center">V</TableHead>
                            <TableHead className="p-2 text-center">SS</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {group.standings.map((standing, index) => (
                            <TableRow key={teamToKey(standing.team)} className={index < teamsPerGroupToAdvance ? "bg-green-100 dark:bg-green-900/30" : ""}>
                                <TableCell className="p-2 font-medium">{teamToKey(standing.team)}</TableCell>
                                <TableCell className="p-2 text-center">{standing.points}</TableCell>
                                <TableCell className="p-2 text-center">{standing.played}</TableCell>
                                <TableCell className="p-2 text-center">{standing.wins}</TableCell>
                                <TableCell className="p-2 text-center">{standing.setDifference > 0 ? `+${standing.setDifference}` : standing.setDifference}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            <Separator />
            <div>
                <h4 className="mb-2 font-semibold">Jogos</h4>
                <div className="space-y-2">
                    {group.matches.map((match, matchIndex) => (
                        <div key={matchIndex} className="flex items-center justify-between gap-2 rounded-md bg-secondary/50 p-2 text-sm">
                            <span className="flex-1 text-right truncate">{teamToKey(match.team1)}</span>
                            <div className="flex items-center gap-1 font-bold">
                                <span>{match.score1 ?? '0'}</span>
                                <span className="text-muted-foreground">x</span>
                                <span>{match.score2 ?? '0'}</span>
                            </div>
                            <span className="flex-1 text-left truncate">{teamToKey(match.team2)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </CardContent>
    </Card>
);

export default function TournamentPage({ params }: { params: { category: string } }) {
    const [data, setData] = useState<CategoryData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const decodedCategory = decodeURIComponent(params.category);
        
        const fetchData = async () => {
            try {
                // Don't set loading to true on refetch
                const tournamentData = await getTournamentByCategory(decodedCategory);
                if (tournamentData) {
                    setData(tournamentData);
                } else {
                    setError("Categoria não encontrada.");
                }
            } catch (err: any) {
                setError(err.message || "Falha ao carregar os dados do torneio.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
        
        const intervalId = setInterval(fetchData, 60000); // Poll every 1 minute

        return () => clearInterval(intervalId); // Cleanup on component unmount
    }, [params.category]);

    if (isLoading) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-screen w-full items-center justify-center text-red-500">
                <p>{error}</p>
            </div>
        );
    }

    if (!data || !data.tournamentData) {
        return (
            <div className="flex h-screen w-full items-center justify-center text-muted-foreground">
                <p>Nenhum dado de torneio encontrado para esta categoria.</p>
            </div>
        );
    }

    const { tournamentData, playoffs, formValues } = data;
    const categoryName = decodeURIComponent(params.category);

    return (
        <div className="container mx-auto p-4 space-y-8">
            <div className="text-center">
                <h1 className="text-4xl font-bold tracking-tight text-primary">{categoryName}</h1>
                <p className="text-lg text-muted-foreground">Acompanhe os resultados e a classificação em tempo real.</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Fase de Grupos</CardTitle>
                    <CardDescription>Resultados e classificação dos grupos.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {tournamentData.groups.map((group) => (
                        <GroupCard key={group.name} group={group} teamsPerGroupToAdvance={formValues.teamsPerGroupToAdvance} />
                    ))}
                </CardContent>
            </Card>

            {playoffs && Object.keys(playoffs).length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center"><Trophy className="mr-2 h-6 w-6 text-primary" />Playoffs - Mata-Mata</CardTitle>
                        <CardDescription>Chaveamento com base na classificação dos grupos.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Bracket playoffs={playoffs} />
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
