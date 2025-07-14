// lib/scheduler.ts
import { parse, addMinutes, isBefore, differenceInMinutes } from 'date-fns';
import type { TournamentsState, CategoryData, Court, MatchWithScore } from '@/lib/types';

interface SchedulableMatch extends MatchWithScore {
  category: string;
  stage: string;
  players: string[];
  phaseStartTime?: string;
}

function parseTime(str: string): Date {
  return parse(str, 'HH:mm', new Date());
}

function getPlayers(match: MatchWithScore): string[] {
  return [
    match.team1?.player1,
    match.team1?.player2,
    match.team2?.player1,
    match.team2?.player2,
  ].filter(Boolean) as string[];
}

export function scheduleMatches(
  db: TournamentsState,
  courts: Court[],
  estimatedMatchDuration: number,
  tournamentEndTime: string
): { scheduledMatches: Set<string>; unscheduledMatches: string[] } {
  const tournamentEnd = parseTime(tournamentEndTime);
  const sortedCourts = [...courts].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  const scheduledMatches = new Set<string>();
  const unscheduledMatches = new Set<string>();
  const lastPlayedMap = new Map<string, Date>();
  const courtNextAvailable = new Map<string, Date>();
  sortedCourts.forEach((c) => courtNextAvailable.set(c.name, parseTime('08:00')));

  let currentTime = parseTime('08:00');
  while (isBefore(currentTime, tournamentEnd)) {
    const availableCourts = sortedCourts.filter(
      (court) =>
        isBefore(courtNextAvailable.get(court.name)!, currentTime) ||
        courtNextAvailable.get(court.name)!.getTime() === currentTime.getTime()
    );
    if (availableCourts.length === 0) {
      currentTime = addMinutes(currentTime, 1);
      continue;
    }

    const allMatches: SchedulableMatch[] = [];
    for (const categoryName of Object.keys(db).sort()) {
      if (categoryName === '_globalSettings') continue;
      const category = db[categoryName] as CategoryData;

      const playoffMatches = Object.entries(category.playoffs || {}).flatMap(([stage, matches]) =>
        matches.map((m) => ({ ...m, category: categoryName, stage, players: getPlayers(m) }))
      );

      const groupMatches = (category.tournamentData.groups ?? []).flatMap((group) =>
        group.matches.map((m) => ({ ...m, category: categoryName, stage: group.name, players: getPlayers(m) }))
      );

      allMatches.push(...groupMatches, ...playoffMatches);
    }

    const readyMatches = allMatches.filter((match) => {
      if (scheduledMatches.has(match.id)) return false;
      if (match.phaseStartTime && isBefore(currentTime, parseTime(match.phaseStartTime))) return false;
      return match.players.every(
        (p) => !lastPlayedMap.has(p) || differenceInMinutes(currentTime, lastPlayedMap.get(p)!) >= estimatedMatchDuration
      );
    });

    for (const court of availableCourts) {
      const match = readyMatches.find((m) => !scheduledMatches.has(m.id));
      if (!match) continue;

      match.time = currentTime.toTimeString().slice(0, 5);
      match.court = court.name;
      scheduledMatches.add(match.id);
      match.players.forEach((p) => lastPlayedMap.set(p, currentTime));
      courtNextAvailable.set(court.name, addMinutes(currentTime, estimatedMatchDuration));
    }

    currentTime = addMinutes(currentTime, 1);
  }

  const allMatchIds = new Set<string>();
  for (const categoryName of Object.keys(db)) {
    if (categoryName === '_globalSettings') continue;
    const category = db[categoryName] as CategoryData;
    for (const group of category.tournamentData.groups ?? []) {
      for (const match of group.matches) allMatchIds.add(match.id);
    }
    for (const matches of Object.values(category.playoffs ?? {})) {
      for (const match of matches) allMatchIds.add(match.id);
    }
  }

  for (const matchId of allMatchIds) {
    if (!scheduledMatches.has(matchId)) {
      unscheduledMatches.add(matchId);
    }
  }

  return {
    scheduledMatches,
    unscheduledMatches: Array.from(unscheduledMatches),
  };
}
