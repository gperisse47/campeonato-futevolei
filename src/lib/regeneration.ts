

'use server';

import { useCallback } from "react";
import type { TournamentFormValues, PlayoffBracketSet, GenerateTournamentGroupsOutput, PlayoffBracket, Team, MatchWithScore, GroupWithScores, TeamStanding, PlayoffMatch } from "./types";

const teamToKey = (team?: Team) => {
    if (!team || !team.player1 || !team.player2) return '';
    return `${team.player1} e ${team.player2}`;
};

export async function calculateTotalMatches(categoryData: { formValues: TournamentFormValues, tournamentData: { groups: any[] } | null, playoffs: PlayoffBracketSet | null }): Promise<number> {
    let count = 0;
    const { formValues, tournamentData, playoffs } = categoryData;
    
    if (formValues.tournamentType === 'groups' && tournamentData) {
        count += tournamentData.groups.reduce((acc, group) => acc + group.matches.length, 0);
    }

    const countMatchesInBracket = (bracket: PlayoffBracket | undefined): number => {
        if (!bracket) return 0;
        return Object.values(bracket).reduce((total, round) => total + round.length, 0);
    };

    if (playoffs) {
        if (formValues.tournamentType === 'doubleElimination' && ('upper' in playoffs || 'lower' in playoffs || 'playoffs' in playoffs)) {
            const bracketSet = playoffs as PlayoffBracketSet;
            count += countMatchesInBracket(bracketSet.upper);
            count += countMatchesInBracket(bracketSet.lower);
            count += countMatchesInBracket(bracketSet.playoffs);
        } else {
            count += countMatchesInBracket(playoffs as PlayoffBracket);
        }
    }
    return count;
};

export async function initializeStandings(groups: GenerateTournamentGroupsOutput['groups'], categoryName: string): Promise<GroupWithScores[]> {
    const categoryPrefix = categoryName.replace(/\s/g, '');
    return groups.map(group => {
      const standings: Record<string, Omit<TeamStanding, 'points'>> = {}
      group.teams.forEach(team => {
        const teamKey = teamToKey(team)
        standings[teamKey] = { team, played: 0, wins: 0, setsWon: 0, setDifference: 0 }
      })
      const sortedStandings = Object.values(standings).sort((a, b) => a.team.player1.localeCompare(b.team.player1))
      
      const groupNameId = group.name.replace(/\s/g, '');

      return {
        ...group,
        matches: group.matches.map((match, i) => ({ 
            ...match,
            id: `${categoryPrefix}-${groupNameId}-Jogo${i+1}`,
            score1: undefined, 
            score2: undefined, 
            time: '', 
            court: '' 
        })),
        standings: sortedStandings
      }
    })
};

export async function initializeDoubleEliminationBracket(values: TournamentFormValues, categoryName: string): Promise<PlayoffBracketSet | null> {
    const categoryPrefix = categoryName.replace(/\s/g, '');

    const allTeamsList = values.teams
        .split("\n")
        .map(t => t.trim())
        .filter(Boolean)
        .map(ts => ({ player1: ts.split(/\s+e\s+/i)[0].trim(), player2: ts.split(/\s+e\s+/i)[1].trim() }));

    const numTeams = allTeamsList.length;
    if (numTeams < 2) return null;

    let teams = [...allTeamsList];
    if (values.groupFormationStrategy === 'random') {
        teams.sort(() => Math.random() - 0.5);
    }
    
    const bracketSize = Math.pow(2, Math.ceil(Math.log2(numTeams)));
    const byes = bracketSize - numTeams;

    const teamsWithBye = values.groupFormationStrategy === 'order'
        ? teams.slice(0, byes)
        : teams.slice(numTeams - byes); 

    const teamsInFirstRound = teams.filter(team => !teamsWithBye.some(byeTeam => teamToKey(byeTeam) === teamToKey(team)));
    
    const upperBracket: PlayoffBracket = {};
    let wbRoundCounter = 1;

    let round1Matches: PlayoffMatch[] = [];
    if (teamsInFirstRound.length > 0) {
        const round1Name = `Upper Rodada ${wbRoundCounter}`;
        for (let i = 0; i < teamsInFirstRound.length / 2; i++) {
            const matchId = `${categoryPrefix}-U-R${wbRoundCounter}-J${i + 1}`;
            round1Matches.push({
                id: matchId, name: `Jogo ${i + 1}`,
                team1: teamsInFirstRound[i],
                team2: teamsInFirstRound[teamsInFirstRound.length - 1 - i],
                team1Placeholder: teamToKey(teamsInFirstRound[i]),
                team2Placeholder: teamToKey(teamsInFirstRound[teamsInFirstRound.length - 1 - i]),
                time: '', roundOrder: 100 - wbRoundCounter,
                court: ''
            });
        }
        upperBracket[round1Name] = round1Matches;
    }

    let currentUpperRoundTeamsPlaceholders: string[] = teamsWithBye.map(t => teamToKey(t)!);
    if(round1Matches.length > 0) {
      currentUpperRoundTeamsPlaceholders.push(...round1Matches.map(m => `Vencedor ${m.id}`));
    }
    
    currentUpperRoundTeamsPlaceholders.sort();

    wbRoundCounter++;

    while (currentUpperRoundTeamsPlaceholders.length > 1) {
        const roundName = `Upper Rodada ${wbRoundCounter}`;
        const nextRoundMatches: PlayoffMatch[] = [];
        
        for (let i = 0; i < currentUpperRoundTeamsPlaceholders.length / 2; i++) {
            const team1Placeholder = currentUpperRoundTeamsPlaceholders[i];
            const team2Placeholder = currentUpperRoundTeamsPlaceholders[currentUpperRoundTeamsPlaceholders.length - 1 - i];
            const matchId = `${categoryPrefix}-U-R${wbRoundCounter}-J${i + 1}`;
            
            nextRoundMatches.push({
                id: matchId, name: `Jogo ${i + 1}`,
                team1Placeholder: team1Placeholder,
                team2Placeholder: team2Placeholder,
                time: '', roundOrder: 100 - wbRoundCounter,
                court: ''
            });
        }
        upperBracket[roundName] = nextRoundMatches;
        currentUpperRoundTeamsPlaceholders = nextRoundMatches.map(m => `Vencedor ${m.id}`);
        wbRoundCounter++;
    }

    const lowerBracket: PlayoffBracket = {};
    const wbLosersByRound: { [key: number]: (string | null)[] } = {};
    
    for (let r = 1; r < wbRoundCounter; r++) {
        const roundName = `Upper Rodada ${r}`;
        const wbMatches = upperBracket[roundName] || [];
        wbLosersByRound[r] = wbMatches.map(m => `Perdedor ${m.id}`);
    }

    let lbRoundCounter = 1;
    let lbSurvivors: (string | null)[] = [];

    const r1Losers = wbLosersByRound[1] || [];
    
    if (r1Losers.length > 0) {
      const lbRound1Name = `Lower Rodada ${lbRoundCounter}`;
      const lbRound1Matches: PlayoffMatch[] = [];
      for (let i = 0; i < r1Losers.length / 2; i++) {
        const matchId = `${categoryPrefix}-L-R${lbRoundCounter}-J${i+1}`;
        lbRound1Matches.push({
            id: matchId, name: `Jogo ${i+1}`,
            team1Placeholder: r1Losers[i]!,
            team2Placeholder: r1Losers[r1Losers.length - 1 - i]!,
            time: '', roundOrder: -(lbRoundCounter * 2),
            court: ''
        });
      }
      if(lbRound1Matches.length > 0) lowerBracket[lbRound1Name] = lbRound1Matches;
      lbSurvivors = lbRound1Matches.map(m => `Vencedor ${m.id}`);
      lbRoundCounter++;
    }

    for (let wbR = 2; wbR < wbRoundCounter; wbR++) {
        let contenders = [...lbSurvivors, ...(wbLosersByRound[wbR] || [])].filter(Boolean) as string[];
        
        const dropDownRoundName = `Lower Rodada ${lbRoundCounter}`;
        const dropDownRoundMatches: PlayoffMatch[] = [];
        if (contenders.length > 0) {
            for (let i = 0; i < contenders.length / 2; i++) {
                const matchId = `${categoryPrefix}-L-R${lbRoundCounter}-J${i + 1}`;
                dropDownRoundMatches.push({
                    id: matchId, name: `Jogo ${i + 1}`,
                    team1Placeholder: contenders[i]!,
                    team2Placeholder: contenders[contenders.length - 1 - i]!,
                    time: '', roundOrder: -(lbRoundCounter * 2),
                    court: ''
                });
            }
        }
        if (dropDownRoundMatches.length > 0) {
            lowerBracket[dropDownRoundName] = dropDownRoundMatches;
        }

        let currentSurvivors = dropDownRoundMatches.map(m => `Vencedor ${m.id}`);
        lbRoundCounter++;

        if (currentSurvivors.length > 1) {
            const internalRoundName = `Lower Rodada ${lbRoundCounter}`;
            const internalRoundMatches: PlayoffMatch[] = [];
             for (let i = 0; i < currentSurvivors.length / 2; i++) {
                const matchId = `${categoryPrefix}-L-R${lbRoundCounter}-J${i + 1}`;
                internalRoundMatches.push({
                    id: matchId, name: `Jogo ${i + 1}`,
                    team1Placeholder: currentSurvivors[i]!,
                    team2Placeholder: currentSurvivors[currentSurvivors.length - 1 - i]!,
                    time: '', roundOrder: -(lbRoundCounter * 2 - 1),
                    court: ''
                });
            }
             if (internalRoundMatches.length > 0) {
                lowerBracket[internalRoundName] = internalRoundMatches;
            }
            lbSurvivors = internalRoundMatches.map(m => `Vencedor ${m.id}`);
        } else {
           lbSurvivors = currentSurvivors;
        }

        lbRoundCounter++;
    }
    
    const wbFinalist = `Vencedor ${upperBracket[`Upper Rodada ${wbRoundCounter-1}`]?.[0]?.id}`;
    const lbFinalist = lbSurvivors[0];

    const finalPlayoffs: PlayoffBracket = {};
    const grandFinalName = "Grande Final";
    finalPlayoffs[grandFinalName] = [
        { id: `${categoryPrefix}-GF-J1`, name: grandFinalName, team1Placeholder: wbFinalist, team2Placeholder: lbFinalist!, time: '', roundOrder: 101, court: '' }
    ];

    if (values.includeThirdPlace) {
       const wbFinalRoundName = `Upper Rodada ${wbRoundCounter - 1}`;
       const lbFinalRoundName = `Lower Rodada ${lbRoundCounter - 2}`;
       
       const wbSemiFinalistLoser = `Perdedor ${upperBracket[wbFinalRoundName]?.[0]?.id}`;
       const lbSemiFinalistLoser = `Perdedor ${lowerBracket[lbFinalRoundName]?.[0]?.id}`;

        if (wbSemiFinalistLoser && lbSemiFinalistLoser) {
            const thirdPlaceName = "Disputa de 3º Lugar";
            finalPlayoffs[thirdPlaceName] = [
                { id: `${categoryPrefix}-3P-J1`, name: thirdPlaceName, team1Placeholder: wbSemiFinalistLoser, team2Placeholder: lbSemiFinalistLoser, time: '', roundOrder: 0, court: '' }
            ];
        }
    }

    return { upper: upperBracket, lower: lowerBracket, playoffs: finalPlayoffs };
};

export async function initializePlayoffs(values: TournamentFormValues, categoryName: string, aiResult?: GenerateTournamentGroupsOutput): Promise<PlayoffBracketSet | null> {
        const categoryPrefix = categoryName.replace(/\s/g, '');

        if (values.tournamentType === 'doubleElimination') {
          return initializeDoubleEliminationBracket(values, categoryName);
        }
        if (values.tournamentType === 'singleElimination') {
            if (!aiResult?.playoffMatches) return null;

            const totalQualifiers = values.numberOfTeams;
            if (totalQualifiers < 2) return null;
            
            let bracket: PlayoffBracket = {};
            
            const numTeams = totalQualifiers;
            const isPowerOfTwo = numTeams > 1 && (numTeams & (numTeams - 1)) === 0;
            if (!isPowerOfTwo) {
                return null;
            }
            
            let teamsInRound = totalQualifiers;
            let roundOrder = Math.log2(teamsInRound);
            
            let currentRoundMatches: PlayoffMatch[] = aiResult.playoffMatches.map((match, i) => ({
                id: `${categoryPrefix}-Rodada1-Jogo${i + 1}`,
                name: `Jogo ${i + 1}`,
                team1: match.team1,
                team2: match.team2,
                team1Placeholder: teamToKey(match.team1),
                team2Placeholder: teamToKey(match.team2),
                time: '',
                court: '',
                roundOrder: roundOrder
            }));

            bracket[`Rodada 1`] = currentRoundMatches;
            
            teamsInRound /= 2;
            roundOrder--;
            let upperRound = 2;

            while (teamsInRound >= 2) { 
                const roundNameKey = teamsInRound === 4 ? 'Semifinal' : (teamsInRound === 2 ? 'Final' : `Quartas de Final`);
                const roundName = teamsInRound === 4 ? 'Semifinal' : (teamsInRound === 2 ? 'Final' : `Quartas de Final`);
                const nextRoundPlaceholders = [];
                for (let i = 0; i < currentRoundMatches.length; i++) {
                     nextRoundPlaceholders.push(`Vencedor ${currentRoundMatches[i].id}`);
                }
                
                const nextRoundMatches: PlayoffMatch[] = [];
                for (let i = 0; i < nextRoundPlaceholders.length / 2; i++) {
                    const matchName = `${roundName} ${i + 1}`;
                    const matchId = `${categoryPrefix}-${roundNameKey.replace(/\s/g, '')}-Jogo${i + 1}`;
                    nextRoundMatches.push({
                        id: matchId,
                        name: matchName,
                        team1Placeholder: nextRoundPlaceholders[i*2],
                        team2Placeholder: nextRoundPlaceholders[i*2 + 1],
                        time: '',
                        court: '',
                        roundOrder
                    });
                }

                currentRoundMatches = nextRoundMatches;
                bracket[roundNameKey] = currentRoundMatches;
                
                if(teamsInRound === 2) break;

                teamsInRound /= 2;
                roundOrder--;
                upperRound++;
            }
            
            if (values.includeThirdPlace && bracket['Semifinal']) {
                const semiFinalLosers = bracket['Semifinal'].map(m => `Perdedor ${m.id}`);
                
                bracket['Disputa de 3º Lugar'] = [
                    { id: `${categoryPrefix}-Disputa3Lugar-Jogo1`, name: 'Disputa de 3º Lugar', team1Placeholder: semiFinalLosers[0], team2Placeholder: semiFinalLosers[1], time: '', court: '', roundOrder: 0 }
                ];
            }
            
            return bracket;

        } else if (values.tournamentType === 'groups') {
            const getTeamPlaceholder = (groupIndex: number, position: number) => {
                const groupNameId = `Group${String.fromCharCode(65 + groupIndex)}`;
                return `${position}º do ${categoryPrefix}-${groupNameId}`;
            };

            const { numberOfGroups, teamsPerGroupToAdvance, includeThirdPlace } = values;
            const totalQualifiers = numberOfGroups! * teamsPerGroupToAdvance!;

            if (totalQualifiers < 2 || (totalQualifiers & (totalQualifiers - 1)) !== 0) {
                return null
            }

            let bracket: PlayoffBracket = {};
            const teamPlaceholders = [];
            for (let i = 0; i < numberOfGroups!; i++) {
                for (let j = 1; j <= teamsPerGroupToAdvance!; j++) {
                    teamPlaceholders.push(getTeamPlaceholder(i, j));
                }
            }
            
            const firstRoundMatchups = [];
            
            if (totalQualifiers === 8 && numberOfGroups === 4 && teamsPerGroupToAdvance === 2) {
                // Specific pairing for 8 qualifiers from 4 groups
                firstRoundMatchups.push(
                    { team1Placeholder: getTeamPlaceholder(0, 1), team2Placeholder: getTeamPlaceholder(3, 2) }, // 1A vs 2D
                    { team1Placeholder: getTeamPlaceholder(1, 2), team2Placeholder: getTeamPlaceholder(2, 1) }, // 2B vs 1C
                    { team1Placeholder: getTeamPlaceholder(1, 1), team2Placeholder: getTeamPlaceholder(2, 2) }, // 1B vs 2C
                    { team1Placeholder: getTeamPlaceholder(0, 2), team2Placeholder: getTeamPlaceholder(3, 1) }  // 2A vs 1D
                );
            } else {
                 const half = teamPlaceholders.length / 2;
                for (let i = 0; i < half; i++) {
                    firstRoundMatchups.push({
                        team1Placeholder: teamPlaceholders[i],
                        team2Placeholder: teamPlaceholders[teamPlaceholders.length - 1 - i],
                    });
                }
            }


            let teamsInRound = totalQualifiers;
            let roundOrder = Math.log2(teamsInRound);
            let currentMatchups = firstRoundMatchups;
            let roundCounter = 1;

            while (teamsInRound >= 2) {
                const roundName = teamsInRound === 2 ? 'Final' : (teamsInRound === 4 ? 'Semifinal' : (teamsInRound === 8 ? 'Quartas de Final' : `Rodada ${roundCounter}`));
                const roundNameKey = roundName.replace(/\s/g, '');
                bracket[roundName] = [];
                const nextRoundPlaceholders = [];

                for (let i = 0; i < currentMatchups.length; i++) {
                    const match = currentMatchups[i];
                    const matchName = `${roundName} ${i + 1}`;
                    const matchId = `${categoryPrefix}-${roundNameKey}-Jogo${i + 1}`;

                    let phaseStartTime = '';
                    if (roundName === 'Quartas de Final') phaseStartTime = values.quarterFinalsStartTime || '';
                    if (roundName === 'Semifinal') phaseStartTime = values.semiFinalsStartTime || '';
                    if (roundName === 'Final') phaseStartTime = values.finalStartTime || '';
                    
                     bracket[roundName].push({
                        id: matchId,
                        name: matchName,
                        team1Placeholder: match.team1Placeholder,
                        team2Placeholder: match.team2Placeholder,
                        time: '',
                        court: '',
                        roundOrder,
                        phaseStartTime,
                    });
                    nextRoundPlaceholders.push(`Vencedor ${matchId}`);
                }

                if(nextRoundPlaceholders.length < 2) break;

                const nextMatchups = [];
                if (roundName === 'Quartas de Final') {
                    // Specific pairing for semifinals from QF winners
                    nextMatchups.push({
                        team1Placeholder: nextRoundPlaceholders[0], // Vencedor QF 1
                        team2Placeholder: nextRoundPlaceholders[3]  // Vencedor QF 4
                    });
                     nextMatchups.push({
                        team1Placeholder: nextRoundPlaceholders[2], // Vencedor QF 3
                        team2Placeholder: nextRoundPlaceholders[1]  // Vencedor QF 2
                    });
                } else {
                    for(let i=0; i < nextRoundPlaceholders.length / 2; i++) {
                        nextMatchups.push({
                            team1Placeholder: nextRoundPlaceholders[i],
                            team2Placeholder: nextRoundPlaceholders[nextRoundPlaceholders.length - 1 - i],
                        });
                    }
                }
                currentMatchups = nextMatchups;
                teamsInRound /= 2;
                roundOrder--;
                roundCounter++;
            }
            
            if (includeThirdPlace && bracket['Semifinal']) {
                const semiFinalLosers = bracket['Semifinal'].map(m => `Perdedor ${m.id}`);
                
                bracket['Disputa de 3º Lugar'] = [
                    { id: `${categoryPrefix}-Disputa3Lugar-Jogo1`, name: 'Disputa de 3º Lugar', team1Placeholder: semiFinalLosers[0], team2Placeholder: semiFinalLosers[1], time: '', court: '', roundOrder: 0, phaseStartTime: values.finalStartTime || '' }
                ];
            }

            return bracket;
        }
        return null;
    };
