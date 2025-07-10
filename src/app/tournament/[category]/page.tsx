

"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { useParams } from 'next/navigation'
import { getTournamentByCategory } from "@/app/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Loader2, Trophy, Clock } from "lucide-react";
import type { CategoryData, PlayoffBracket, PlayoffMatch, Team, GroupWithScores, PlayoffBracketSet, MatchWithScore } from "@/lib/types";

const roundNames: { [key: string]: string } = {
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

    const placeholder1 = (match.team1Placeholder || '').replace(/Vencedor Semifinal-\d/, 'Vencedor Semifinal').replace(/Perdedor Semifinal-\d/, 'Perdedor Semifinal');
    const placeholder2 = (match.team2Placeholder || '').replace(/Vencedor Semifinal-\d/, 'Vencedor Semifinal').replace(/Perdedor Semifinal-\d/, 'Perdedor Semifinal');
    
    const scoresDefined = match.score1 !== undefined && match.score2 !== undefined;
    const showMatchName = roundName !== 'Final' && roundName !== 'Disputa de 3º Lugar';


    return (
        <div className="flex flex-col gap-2 w-full">
            {showMatchName && <h4 className="text-sm font-semibold text-center text-muted-foreground whitespace-nowrap">{match.name}</h4>}
            <div className={`p-2 rounded-md space-y-2 ${isFinalRound ? 'max-w-xl' : 'max-w-sm'} w-full mx-auto`}>
               {scoresDefined ? (
                 <>
                    <div className={`flex items-center w-full p-2 rounded-md ${winnerKey && team1Key && winnerKey === team1Key ? 'bg-green-100 dark:bg-green-900/30' : 'bg-secondary/50'}`}>
                        <span className={`text-left pr-2 text-sm flex-1`}>{match.team1 ? teamToKey(match.team1) : placeholder1}</span>
                        <span className="h-8 w-14 shrink-0 text-center font-bold flex items-center justify-center">{match.score1}</span>
                    </div>
                    <div className="text-muted-foreground text-xs text-center py-1">vs</div>
                    <div className={`flex items-center w-full p-2 rounded-md ${winnerKey && team2Key && winnerKey === team2Key ? 'bg-green-100 dark:bg-green-900/30' : 'bg-secondary/50'}`}>
                        <span className={`text-left pr-2 text-sm flex-1`}>{match.team2 ? teamToKey(match.team2) : placeholder2}</span>
                        <span className="h-8 w-14 shrink-0 text-center font-bold flex items-center justify-center">{match.score2}</span>
                    </div>
                 </>
               ) : (
                <div className="flex items-center justify-between gap-2 rounded-md bg-secondary/50 p-2 text-sm">
                    <span className="flex-1 text-right">{match.team1 ? teamToKey(match.team1) : placeholder1}</span>
                    <span className="text-muted-foreground font-bold text-xs px-2">vs</span>
                    <span className="flex-1 text-left">{match.team2 ? teamToKey(match.team2) : placeholder2}</span>
                </div>
               )}
            </div>
        </div>
    );
};

const Bracket = ({ playoffs, title }: { playoffs: PlayoffBracket, title?: string }) => {
    if (!playoffs || Object.keys(playoffs).length === 0) {
        return null;
    }
    const roundOrder = Object.keys(playoffs).sort((a,b) => (playoffs[b][0]?.roundOrder || 0) - (playoffs[a][0]?.roundOrder || 0));

    // Special handling for Grand Final in double elimination
    if (playoffs['Grande Final']) {
        const grandFinalIndex = roundOrder.indexOf('Grande Final');
        if (grandFinalIndex > -1) {
            roundOrder.splice(grandFinalIndex, 1);
            roundOrder.push('Grande Final');
        }
    }
    
    return (
        <Card className="w-full">
            <CardHeader>
                <CardTitle className="flex items-center">
                    {title && <Trophy className="mr-2 h-6 w-6 text-primary" />}
                    {title || 'Chaveamento'}
                </CardTitle>
                {!title && <CardDescription>Chaveamento com base nos resultados.</CardDescription>}
            </CardHeader>
            <CardContent className="flex flex-col items-center w-full overflow-x-auto p-4 gap-8">
                 {roundOrder.map(roundName => (
                    <Card key={roundName} className="w-full max-w-xl">
                        <CardHeader>
                            <CardTitle className="text-lg font-bold text-primary">{roundName}</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-8 w-full">
                            {playoffs[roundName].map((match) => (
                                <PlayoffMatchCard
                                    key={match.id}
                                    match={match}
                                    roundName={roundName}
                                    isFinalRound={roundName.includes('Final') || roundName.includes('Disputa de 3º Lugar')}
                                />
                            ))}
                        </CardContent>
                    </Card>
                ))}
            </CardContent>
        </Card>
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
                            <TableHead className="p-2 text-center">V</TableHead>
                            <TableHead className="p-2 text-center">J</TableHead>
                            <TableHead className="p-2 text-center">PP</TableHead>
                            <TableHead className="p-2 text-center">SP</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {group.standings.map((standing, index) => (
                            <TableRow key={teamToKey(standing.team)} className={index < teamsPerGroupToAdvance ? "bg-green-100 dark:bg-green-900/30" : ""}>
                                <TableCell className="p-2 font-medium">{teamToKey(standing.team)}</TableCell>
                                <TableCell className="p-2 text-center">{standing.wins}</TableCell>
                                <TableCell className="p-2 text-center">{standing.played}</TableCell>
                                <TableCell className="p-2 text-center">{standing.setsWon}</TableCell>
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
                            {match.score1 !== undefined && match.score2 !== undefined ? (
                                <div className="flex items-center gap-1 font-bold">
                                    <span>{match.score1}</span>
                                    <span className="text-muted-foreground">x</span>
                                    <span>{match.score2}</span>
                                </div>
                            ) : (
                                <span className="text-muted-foreground font-bold text-xs">vs</span>
                            )}
                            <span className="flex-1 text-left truncate">{teamToKey(match.team2)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </CardContent>
    </Card>
);

export default function TournamentPage() {
    const params = useParams();
    const [data, setData] = useState<CategoryData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [firstMatchTime, setFirstMatchTime] = useState<string | null>(null);

    const category = Array.isArray(params.category) ? params.category[0] : params.category;

    useEffect(() => {
        if (!category) return;
        
        const decodedCategory = decodeURIComponent(category);
        
        const fetchData = async () => {
            try {
                // Don't set loading to true on refetch
                const tournamentData = await getTournamentByCategory(decodedCategory);
                if (tournamentData) {
                    setData(tournamentData);
                    
                    // Find the first match time
                    let allMatches: (MatchWithScore | PlayoffMatch)[] = [];
                    if (tournamentData.tournamentData?.groups) {
                        allMatches.push(...tournamentData.tournamentData.groups.flatMap(g => g.matches));
                    }
                    if (tournamentData.playoffs) {
                         if ('upper' in tournamentData.playoffs || 'lower' in tournamentData.playoffs || 'playoffs' in tournamentData.playoffs) {
                            const bracketSet = tournamentData.playoffs as PlayoffBracketSet;
                             if(bracketSet.upper) allMatches.push(...Object.values(bracketSet.upper).flat());
                             if(bracketSet.lower) allMatches.push(...Object.values(bracketSet.lower).flat());
                             if(bracketSet.playoffs) allMatches.push(...Object.values(bracketSet.playoffs).flat());
                         } else {
                            allMatches.push(...Object.values(tournamentData.playoffs as PlayoffBracket).flat());
                         }
                    }

                    const sortedMatches = allMatches
                        .filter(m => m.time && m.time !== 'N/A')
                        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
                        
                    setFirstMatchTime(sortedMatches.length > 0 ? sortedMatches[0].time! : null);

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
        
        const intervalId = setInterval(fetchData, 5000); // Poll every 5 seconds

        return () => clearInterval(intervalId); // Cleanup on component unmount
    }, [category]);

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

    if (!data) {
        return (
            <div className="flex h-screen w-full items-center justify-center text-muted-foreground">
                <p>Nenhum dado de torneio encontrado para esta categoria.</p>
            </div>
        );
    }

    const { tournamentData, playoffs, formValues } = data;
    const categoryName = decodeURIComponent(category || '');
    const isGroupTournament = formValues.tournamentType === 'groups';

    const getBracketRounds = (bracket: PlayoffBracket | undefined) => {
        if (!bracket) return {};
        return Object.keys(bracket).reduce((acc, key) => {
            if(bracket[key].length > 0) acc[key] = bracket[key];
            return acc;
        }, {} as PlayoffBracket);
    }

    const upperBracket = getBracketRounds((playoffs as PlayoffBracketSet)?.upper);
    const lowerBracket = getBracketRounds((playoffs as PlayoffBracketSet)?.lower);
    const finalPlayoffs = getBracketRounds((playoffs as PlayoffBracketSet)?.playoffs);


    return (
        <div className="container mx-auto p-4 space-y-8">
            <div className="text-center space-y-4">
                <h1 className="text-4xl font-bold tracking-tight text-primary">{categoryName}</h1>
                <p className="text-lg text-muted-foreground">Acompanhe os jogos e classificações em tempo real.</p>
                 <Card className="max-w-md mx-auto">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center justify-center gap-2"><Clock className="h-5 w-5"/> Horários</CardTitle>
                    </CardHeader>
                    <CardContent className="flex justify-around text-sm">
                        <div className="text-center">
                            <div className="font-semibold">Início Desejado</div>
                            <div className="text-muted-foreground">{formValues.startTime || 'Não especificado'}</div>
                        </div>
                        <div className="text-center">
                            <div className="font-semibold">Início Real</div>
                            <div className="text-muted-foreground">{firstMatchTime || 'Aguardando'}</div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {isGroupTournament && tournamentData && (
                <Card>
                    <CardHeader>
                        <CardTitle>Fase de Grupos</CardTitle>
                        <CardDescription>Resultados e classificação dos grupos.</CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {tournamentData.groups.map((group) => (
                            <GroupCard key={group.name} group={group} teamsPerGroupToAdvance={formValues.teamsPerGroupToAdvance!} />
                        ))}
                    </CardContent>
                </Card>
            )}

            {formValues.tournamentType === 'singleElimination' && playoffs && Object.keys(playoffs).length > 0 && (
                 <Bracket playoffs={playoffs as PlayoffBracket} title="Playoffs - Mata-Mata" />
            )}

            {formValues.tournamentType === 'doubleElimination' && (
                <div className="space-y-8">
                   {Object.keys(upperBracket).length > 0 && <Bracket playoffs={upperBracket} title="Chave Superior (Winners)" />}
                   {Object.keys(lowerBracket).length > 0 && <Bracket playoffs={lowerBracket} title="Chave Inferior (Losers)" />}
                   {Object.keys(finalPlayoffs).length > 0 && <Bracket playoffs={finalPlayoffs} title="Fase Final" />}
                </div>
            )}

             {isGroupTournament && playoffs && Object.keys(playoffs).length > 0 && (
                <Bracket playoffs={playoffs as PlayoffBracket} title="Playoffs - Mata-Mata" />
            )}
        </div>
    );
}
