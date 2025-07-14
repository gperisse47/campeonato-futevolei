// lib/scheduler.ts
import { parse, addMinutes, isBefore, differenceInMinutes, startOfDay } from 'date-fns';
import type { Court, MatchWithScore, PlayoffMatch, Team } from '@/lib/types';

export type SchedulableMatch = (MatchWithScore | PlayoffMatch) & {
  category: string;
  stage: string;
  players: string[];
};

function parseTime(str: string): Date {
  if (!str || !/^\d{2}:\d{2}$/.test(str)) {
    return new Date(0);
  }
  const [hours, minutes] = str.split(':').map(Number);
  const date = startOfDay(new Date());
  date.setHours(hours, minutes, 0, 0);
  return date;
}

const teamToKey = (team?: Team): string => {
    if (!team || !team.player1 || !team.player2) return '';
    const players = [team.player1.trim(), team.player2.trim()].sort();
    return `${players[0]} e ${players[1]}`;
};

function getPlayers(match: SchedulableMatch): string[] {
  const players = new Set<string>();
    const addTeamPlayers = (team?: Team | string) => {
        if (!team) return;
        if (typeof team === 'string') {
            if(team.includes(' e ')) {
                team.split(' e ').forEach(p => players.add(p.trim()));
            }
        } else {
             if (team.player1) players.add(team.player1.trim());
             if (team.player2) players.add(team.player2.trim());
        }
    };
    addTeamPlayers(match.team1);
    addTeamPlayers(match.team2);
    // Add players from placeholders too if teams are not yet defined
    if (!match.team1 && match.team1Placeholder) addTeamPlayers(match.team1Placeholder);
    if (!match.team2 && match.team2Placeholder) addTeamPlayers(match.team2Placeholder);
    return Array.from(players);
}

function extractMatchDependencies(match: SchedulableMatch): string[] {
    const deps = new Set<string>();
    const placeholders = [match.team1Placeholder, match.team2Placeholder];
    placeholders.forEach(p => {
        if (!p) return;
        const matchDepMatch = p.match(/(?:Vencedor|Perdedor)\s(.+)/);
        if (matchDepMatch && matchDepMatch[1]) {
            deps.add(matchDepMatch[1].trim());
        }
    });
    return Array.from(deps);
}

function extractGroupDependencies(match: SchedulableMatch, groupCompletionDependencies: Record<string, string[]>): string[] {
    const deps = new Set<string>();
    const placeholders = [match.team1Placeholder, match.team2Placeholder];
    placeholders.forEach(p => {
        if (!p) return;
        const groupDepMatch = p.match(/\d+º\sdo\s(.+)/);
        if (groupDepMatch && groupDepMatch[1]) {
            const groupIdentifier = groupDepMatch[1].trim();
            if (groupCompletionDependencies[groupIdentifier]) {
                groupCompletionDependencies[groupIdentifier].forEach(matchId => deps.add(matchId));
            }
        }
    });
    return Array.from(deps);
}


export function scheduleMatches(
    allMatchesInput: SchedulableMatch[],
    courts: Court[],
    estimatedMatchDuration: number,
    tournamentEndTime: string,
    groupCompletionDependencies: Record<string, string[]>
): { scheduledMatches: SchedulableMatch[]; unscheduledMatches: string[] } {
    const tournamentEnd = parseTime(tournamentEndTime);
    const sortedCourts = [...courts].sort((a, b) => (a.priority || 99) - (b.priority || 99));

    const allMatches = JSON.parse(JSON.stringify(allMatchesInput));

    const scheduledMatches = new Set<string>();
    const lastPlayedMap = new Map<string, Date>();
    const courtNextAvailable = new Map<string, Date>();
    sortedCourts.forEach(c => courtNextAvailable.set(c.name, parseTime('08:00')));

    const scheduledMatchObjects: SchedulableMatch[] = [];

    let currentTime = parseTime('08:00');
    let iterations = 0;

    while (scheduledMatches.size < allMatches.length && iterations < 10000) {
        iterations++;
        const matchEndTime = addMinutes(currentTime, estimatedMatchDuration);
        if (isBefore(tournamentEnd, matchEndTime)) {
            break;
        }

        const availableCourts = sortedCourts.filter(court => {
            const nextAvailable = courtNextAvailable.get(court.name) || new Date(0);
            return !isBefore(currentTime, nextAvailable);
        });
        
        if (availableCourts.length === 0) {
            currentTime = addMinutes(currentTime, 1);
            continue;
        }

        const readyMatches = allMatches.filter((match: SchedulableMatch) => {
            if (scheduledMatches.has(match.id!)) return false;

            // Check player availability
            const players = getPlayers(match);
            if (!players.every(p => {
                const lastPlayed = lastPlayedMap.get(p);
                return !lastPlayed || differenceInMinutes(currentTime, lastPlayed) >= 0;
            })) {
                return false;
            }

            // Check match dependencies
            const matchDeps = extractMatchDependencies(match);
            if (!matchDeps.every(depId => scheduledMatches.has(depId))) {
                return false;
            }

            // Check group dependencies
            const groupDeps = extractGroupDependencies(match, groupCompletionDependencies);
            if (!groupDeps.every(depId => scheduledMatches.has(depId))) {
                return false;
            }

            // Check phase start time
            if (match.phaseStartTime && isBefore(currentTime, parseTime(match.phaseStartTime))) {
                return false;
            }

            return true;
        });

        // Simple sort: earliest start time, then by ID
        readyMatches.sort((a: SchedulableMatch, b: SchedulableMatch) => {
            const timeA = a.phaseStartTime ? parseTime(a.phaseStartTime).getTime() : 0;
            const timeB = b.phaseStartTime ? parseTime(b.phaseStartTime).getTime() : 0;
            if (timeA !== timeB) return timeA - timeB;
            return a.id!.localeCompare(b.id!);
        });

        const usedPlayersThisTick = new Set<string>();

        for (const court of availableCourts) {
            const matchToSchedule = readyMatches.find(m =>
                getPlayers(m).every(p => !usedPlayersThisTick.has(p))
            );

            if (matchToSchedule) {
                matchToSchedule.time = format(currentTime, 'HH:mm');
                matchToSchedule.court = court.name;

                scheduledMatches.add(matchToSchedule.id!);
                scheduledMatchObjects.push(matchToSchedule);

                const players = getPlayers(matchToSchedule);
                players.forEach(p => {
                    lastPlayedMap.set(p, addMinutes(currentTime, estimatedMatchDuration));
                    usedPlayersThisTick.add(p);
                });
                courtNextAvailable.set(court.name, addMinutes(currentTime, estimatedMatchDuration));
            }
        }
        
        if(usedPlayersThisTick.size === 0) {
            currentTime = addMinutes(currentTime, 1);
        }
    }

    const allMatchIds = new Set(allMatches.map((m: SchedulableMatch) => m.id));
    const unscheduledMatchIds = Array.from(allMatchIds).filter(id => !scheduledMatches.has(id!));

    return {
        scheduledMatches: scheduledMatchObjects,
        unscheduledMatches: unscheduledMatchIds as string[],
    };
}
