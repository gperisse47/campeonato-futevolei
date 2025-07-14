// lib/scheduler.ts
import { parse as parseDate, format as formatDate, addMinutes, isEqual, differenceInMinutes } from "date-fns";

export interface MatchRow {
  matchId: string;
  category: string;
  stage: string;
  team1: string;
  team2: string;
  dependencies: string[];
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
  stage: string; 
  team1: string;
  team2: string;
  players: string[];
  dependencies: string[];
  time?: string;
  court?: string;

  constructor(row: MatchRow) {
    this.id = row.matchId;
    this.category = row.category;
    this.stage = row.stage;
    this.team1 = row.team1;
    this.team2 = row.team2;
    this.players = this.extractPlayers(this.team1).concat(this.extractPlayers(this.team2));
    this.dependencies = row.dependencies;
  }

  private extractPlayers(team: string): string[] {
    if (!team || !team.includes(' e ')) return [];
    return team.split(/\s+e\s+/).map(p => p.trim()).filter(Boolean);
  }
}


function getStagePriority(stage: string): number {
  const s = stage.toLowerCase();
  if (s.includes("final") && !s.includes("disputa")) return 100;
  if (s.includes("disputa de 3") || s.includes("disputa3")) return 99;
  if (s.includes("semifinal")) return 98;
  if (s.includes("quartas")) return 97;
  if (s.includes("oitavas")) return 96;
  if (s.includes("group") || s.includes("grupo")) return 1;
  return 0; 
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

  const categoryStartTimes: Record<string, Date> = {};
  const categoryPlayoffPriority: Record<string, number> = {};
  const stageMinStartTimes: Record<string, Record<string, Date>> = {};

  Object.entries(parameters).forEach(([key, val]) => {
    const matchTime = key.match(/(.+)__startTime/);
    if (matchTime) categoryStartTimes[matchTime[1]] = parseDate(val, "HH:mm", new Date());

    const matchPriority = key.match(/(.+)__playoffPriority/);
    if (matchPriority) categoryPlayoffPriority[matchPriority[1]] = parseInt(val, 10);

    const stageMinTime = key.match(/^(.+)__stageMinTime_(.+)$/);
    if (stageMinTime) {
      const [_, category, stage] = stageMinTime;
      if (!stageMinStartTimes[category]) stageMinStartTimes[category] = {};
      stageMinStartTimes[category][stage] = parseDate(val, "HH:mm", new Date());
    }
  });

  const matches = matchesInput.map(row => new Match(row));
  const matchesById = new Map(matches.map(m => [m.id, m]));
  
  const matchHistory: Record<string, Date[]> = {};
  const playerAvailability: Record<string, Date> = {};
  let currentTime = new Date(Math.min(...Object.values(categoryStartTimes).map(d => d.getTime() || Infinity)));
  const unscheduled = new Set(matches.map(m => m.id));

  function playedTwoConsecutive(player: string, time: Date): boolean {
    const times = (matchHistory[player] || []).filter(t => t < time).sort((a, b) => a.getTime() - b.getTime());
    return times.length >= 2 &&
      isEqual(times[times.length - 1], addMinutes(time, -matchDuration)) &&
      isEqual(times[times.length - 2], addMinutes(time, -2 * matchDuration));
  }
  
  let loopCounter = 0;
  const MAX_LOOPS = 500; // Safety break

  while (unscheduled.size > 0 && loopCounter < MAX_LOOPS) {
    loopCounter++;
    const loopStartTime = new Date(currentTime);

    if (addMinutes(currentTime, matchDuration) > END_OF_DAY) {
      console.warn(`[ALERTA] Horário final do campeonato ultrapassado: ${formatDate(currentTime, 'HH:mm')}`);
      break;
    }

    const availableCourts = courts.filter(c =>
      c.slots.some(({ start, end }) => start <= currentTime && addMinutes(currentTime, matchDuration) <= end) &&
      c.nextAvailable <= currentTime
    ).sort((a,b) => a.name.localeCompare(b.name));

    const readyMatches: Match[] = [];
    for (const matchId of unscheduled) {
        const m = matchesById.get(matchId)!;
        
        if (currentTime < (categoryStartTimes[m.category] || new Date(0))) continue;
        
        const dependenciesMet = m.dependencies.every(depId => {
            const depMatch = matchesById.get(depId);
            return depMatch && !!depMatch.time; // Check if dependency is scheduled
        });
        
        const minStageStart = stageMinStartTimes[m.category]?.[m.stage];
        const canStart = !minStageStart || currentTime >= minStageStart;

        if (dependenciesMet && canStart &&
            m.players.every(p => (playerAvailability[p] || new Date(0)) <= currentTime) &&
            m.players.every(p => !playedTwoConsecutive(p, currentTime))) {
          readyMatches.push(m);
        }
    }
    
    readyMatches.sort((a, b) => {
      const stagePrioA = getStagePriority(a.stage);
      const stagePrioB = getStagePriority(b.stage);
      if (stagePrioA !== stagePrioB) return stagePrioB - stagePrioA;

      // Se a prioridade da fase for a mesma, usa a prioridade da categoria como desempate
      const catPrioA = categoryPlayoffPriority[a.category] ?? 999;
      const catPrioB = categoryPlayoffPriority[b.category] ?? 999;
      if (catPrioA !== catPrioB) return catPrioA - catPrioB;
      
      const rest = (m: Match) => {
        if (m.players.length === 0) return { min: Infinity, sum: Infinity };
        const rests = m.players.map(p => differenceInMinutes(currentTime, playerAvailability[p] || new Date(0)));
        return {
          min: Math.min(...rests),
          sum: rests.reduce((acc, val) => acc + val, 0)
        };
      };

      const ar = rest(a);
      const br = rest(b);
      return br.sum - ar.sum || br.min - ar.min; // Prioritize sum of rests, then min rest
    });
    
    const usedPlayers = new Set<string>();
    for (const court of availableCourts) {
        const match = readyMatches.find(m => m.players.every(p => !usedPlayers.has(p)));
        if (!match) continue;

        match.time = formatDate(currentTime, "HH:mm");
        match.court = court.name;
        court.nextAvailable = addMinutes(currentTime, matchDuration);
        
        for (const p of match.players) {
            playerAvailability[p] = addMinutes(currentTime, matchDuration);
            if (!matchHistory[p]) matchHistory[p] = [];
            matchHistory[p].push(currentTime);
            usedPlayers.add(p);
        }
        unscheduled.delete(match.id);
    }

    // Avança o tempo se nenhum jogo foi agendado neste slot
    if (isEqual(currentTime, loopStartTime)) {
      currentTime = addMinutes(currentTime, matchDuration);
    }
  }
  
  if(unscheduled.size > 0){
      console.warn(`[ALERTA] ${unscheduled.size} jogos não puderam ser agendados.`);
  }

  return matches;
}
