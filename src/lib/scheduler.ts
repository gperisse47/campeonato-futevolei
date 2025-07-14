// lib/scheduler.ts
import { parse as parseDate, format as formatDate, addMinutes, isEqual, differenceInMinutes } from "date-fns";

export interface MatchRow {
  matchId: string;
  category: string;
  stage: string;
  team1: string;
  team2: string;
}

interface CourtSlot {
  start: Date;
  end: Date;
}

class Court {
  name: string;
  slots: CourtSlot[];
  nextAvailable: Date = new Date(0);

  constructor(name: string, slots: [string, string][]) {
    this.name = name;
    this.slots = slots.map(([start, end]) => ({
      start: parseDate(start, "HH:mm", new Date()),
      end: parseDate(end, "HH:mm", new Date())
    }));
  }
}

class Match {
  id: string;
  category: string;
  team1: string;
  team2: string;
  stage: string;
  players: string[];
  time?: string;
  court?: string;

  constructor(row: MatchRow) {
    this.id = row.matchId;
    this.category = row.category;
    this.stage = row.stage;
    this.team1 = row.team1;
    this.team2 = row.team2;
    this.players = this.extractPlayers(this.team1).concat(this.extractPlayers(this.team2));
  }

  private extractPlayers(team: string): string[] {
    if (!team) return [];
    return team.split(/\s*e\s*/).map(p => p.trim());
  }
}

function getStagePriority(stage: string): number {
  const s = stage.toLowerCase();
  if (s.includes("final") && !s.includes("semifinal")) return 5;
  if (s.includes("disputa")) return 4;
  if (s.includes("semifinal")) return 3;
  if (s.includes("quartas")) return 2;
  if (s.includes("oitavas")) return 1;
  return 0; // Fase de grupos
}

export function scheduleMatches(matchesInput: MatchRow[], parameters: Record<string, string>): Match[] {
  const matchDuration = parseInt(parameters["estimatedMatchDuration"] || "20", 10);
  const END_OF_DAY = parseDate(parameters["endTime"] || "21:00", "HH:mm", new Date());

  const courts: Court[] = [];
  Object.entries(parameters).forEach(([k, v]) => {
    const courtMatch = k.match(/court_(\d+)_name/);
    if (courtMatch) {
      const courtId = courtMatch[1];
      const name = v;
      const slots: [string, string][] = [];
      Object.entries(parameters).forEach(([kk, vv]) => {
        const slotMatch = kk.match(new RegExp(`court_${courtId}_slot_\\d+`));
        if (slotMatch) {
          const [start, end] = vv.split("-").map(s => s.trim());
          slots.push([start, end]);
        }
      });
      courts.push(new Court(name, slots));
    }
  });

  const startTimes: Record<string, Date> = {};
  const playoffPriority: Record<string, number> = {};
  const stageMinStartTimes: Record<string, Record<string, Date>> = {};

  Object.entries(parameters).forEach(([key, val]) => {
    const matchTime = key.match(/(.+)__startTime/);
    if (matchTime) startTimes[matchTime[1]] = parseDate(val, "HH:mm", new Date());

    const matchPriority = key.match(/(.+)__playoffPriority/);
    if (matchPriority) playoffPriority[matchPriority[1]] = parseInt(val, 10);

    const stageMinTime = key.match(/^(.+)__stageMinTime_(.+)$/);
    if (stageMinTime) {
      const [_, category, stage] = stageMinTime;
      if (!stageMinStartTimes[category]) stageMinStartTimes[category] = {};
      stageMinStartTimes[category][stage] = parseDate(val, "HH:mm", new Date());
    }
  });

  const matches = matchesInput.map(row => new Match(row));
  const matchesByCatStage: Record<string, Record<string, Match[]>> = {};
  
  for (const match of matches) {
    if (!matchesByCatStage[match.category]) matchesByCatStage[match.category] = {};
    if (!matchesByCatStage[match.category][match.stage]) matchesByCatStage[match.category][match.stage] = [];
    matchesByCatStage[match.category][match.stage].push(match);
  }

  const stagesPerCat: Record<string, string[]> = {};
  const currentStageIdx: Record<string, number> = {};
  for (const cat in matchesByCatStage) {
    const stages = Object.keys(matchesByCatStage[cat]).sort((a, b) => getStagePriority(a) - getStagePriority(b));
    stagesPerCat[cat] = stages;
    currentStageIdx[cat] = 0;
  }

  const matchHistory: Record<string, Date[]> = {};
  const playerAvailability: Record<string, Date> = {};
  let currentTime = new Date(Math.min(...Object.values(startTimes).map(d => d.getTime())));
  const unscheduled = new Set(matches.map(m => m.id));

  function playedTwoConsecutive(player: string, time: Date): boolean {
    const times = (matchHistory[player] || []).filter(t => t < time).sort((a, b) => a.getTime() - b.getTime());
    return times.length >= 2 &&
      isEqual(times[times.length - 1], addMinutes(time, -matchDuration)) &&
      isEqual(times[times.length - 2], addMinutes(time, -2 * matchDuration));
  }

  while (unscheduled.size) {
    if (addMinutes(currentTime, matchDuration) > END_OF_DAY) {
      console.warn(`[ALERTA] Horário final do campeonato ultrapassado: ${formatDate(currentTime, 'HH:mm')}`);
      break;
    }

    const availableCourts = courts.filter(c =>
      c.slots.some(({ start, end }) => start <= currentTime && addMinutes(currentTime, matchDuration) <= end) &&
      c.nextAvailable <= currentTime
    );

    const categoriesSorted = Object.keys(matchesByCatStage)
      .filter(cat => currentTime >= startTimes[cat])
      .sort((a, b) => {
        const pa = playoffPriority[a] ?? 999;
        const pb = playoffPriority[b] ?? 999;
        return pa - pb;
      });

    const readyMatches: Match[] = [];
    for (const cat of categoriesSorted) {
      const stageIdx = currentStageIdx[cat];
      if (stageIdx >= stagesPerCat[cat].length) continue;
      const stage = stagesPerCat[cat][stageIdx];
      const stageMatches = matchesByCatStage[cat][stage]?.filter(m => unscheduled.has(m.id)) || [];
      const minStageStart = stageMinStartTimes[cat]?.[stage];

      for (const m of stageMatches) {
        const canStart = !minStageStart || currentTime >= minStageStart;
        if (canStart &&
            m.players.every(p => (playerAvailability[p] || new Date(0)) <= currentTime) &&
            m.players.every(p => !playedTwoConsecutive(p, currentTime))) {
          readyMatches.push(m);
        }
      }
    }
    
    readyMatches.sort((a, b) => {
      const stageA = getStagePriority(a.stage);
      const stageB = getStagePriority(b.stage);
      if (stageA !== stageB) return stageB - stageA; // Higher stage first

      const pa = playoffPriority[a.category] ?? 999;
      const pb = playoffPriority[b.category] ?? 999;
      if (pa !== pb) return pa - pb;

      const rest = (m: Match) => {
        const rests = m.players.map(p => differenceInMinutes(currentTime, playerAvailability[p] || new Date(0)));
        return {
          min: Math.min(...rests),
          sum: rests.reduce((acc, val) => acc + val, 0)
        };
      };
      const ar = rest(a);
      const br = rest(b);
      return br.min - ar.min || br.sum - ar.sum;
    });

    let scheduled = 0;
    const usedPlayers = new Set<string>();
    for (const court of availableCourts) {
      const match = readyMatches.find(m => m.players.every(p => !usedPlayers.has(p)));
      if (!match) continue;
      match.time = formatDate(currentTime, "HH:mm");
      match.court = court.name;
      court.nextAvailable = addMinutes(currentTime, matchDuration);
      for (const p of match.players) {
        playerAvailability[p] = addMinutes(currentTime, matchDuration);
        matchHistory[p] = [...(matchHistory[p] || []), currentTime];
        usedPlayers.add(p);
      }
      unscheduled.delete(match.id);
      if (matchesByCatStage[match.category][match.stage].every(m => !unscheduled.has(m.id))) {
        currentStageIdx[match.category]++;
      }
      scheduled++;
    }

    currentTime = scheduled === 0 ? addMinutes(currentTime, matchDuration) : currentTime;
  }

  return matches;
}
