
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

export interface SchedulingLog {
  matchId: string;
  category: string;
  stage: string;
  team1: string;
  team2: string;
  reasons: string[];
  checkedAtTime?: string;
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
  phaseStartTime?: Date;

  constructor(row: MatchRow, parameters: Record<string,string>) {
    this.id = row.matchId;
    this.category = row.category;
    this.stage = row.stage;
    this.team1 = row.team1;
    this.team2 = row.team2;
    this.players = this.extractPlayers(this.team1).concat(this.extractPlayers(this.team2));
    this.dependencies = row.dependencies;

    const stageMinTimeKey = `${this.category}__stageMinTime_${this.stage}`;
    if (parameters[stageMinTimeKey]) {
      this.phaseStartTime = parseDate(parameters[stageMinTimeKey], "HH:mm", new Date());
    }
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
    // Lower priority for group stage
    if (s.includes("group") || s.includes("grupo")) return 1;
    // Default for other playoff rounds
    return 50;
}


export function scheduleMatches(matchesInput: MatchRow[], parameters: Record<string, string>): { scheduled: Match[], unscheduled: Match[], logs: SchedulingLog[], partialSchedule: any[] } {
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

  Object.entries(parameters).forEach(([key, val]) => {
    const matchTime = key.match(/(.+)__startTime/);
    if (matchTime) categoryStartTimes[matchTime[1]] = parseDate(val, "HH:mm", new Date());

    const matchPriority = key.match(/(.+)__playoffPriority/);
    if (matchPriority) categoryPlayoffPriority[matchPriority[1]] = parseInt(val, 10);
  });

  const matches = matchesInput.map(row => new Match(row, parameters));
  const matchesById = new Map(matches.map(m => [m.id, m]));

  const matchHistory: Record<string, Date[]> = {};
  const playerAvailability: Record<string, Date> = {};
  let currentTime = new Date(Math.min(...Object.values(categoryStartTimes).map(d => d.getTime() || Infinity)));
  const unscheduled = new Set(matches.map(m => m.id));
  const logs: SchedulingLog[] = [];


  function playedTwoConsecutive(player: string, time: Date): boolean {
    const times = (matchHistory[player] || []).filter(t => t < time).sort((a, b) => a.getTime() - b.getTime());
    if (times.length < 2) return false;

    const lastMatchTime = times[times.length - 1];
    const secondLastMatchTime = times[times.length - 2];
    
    // Check if the difference between the current time and last match time is exactly matchDuration
    const diffLast = differenceInMinutes(time, lastMatchTime);
    if(diffLast !== matchDuration) return false;
    
    // Check if the difference between last and second last match is also matchDuration
    const diffSecondLast = differenceInMinutes(lastMatchTime, secondLastMatchTime);
    return diffSecondLast === matchDuration;
  }

  let loopCounter = 0;
  const MAX_LOOPS = 5000;

  while (unscheduled.size > 0 && loopCounter < MAX_LOOPS) {
    loopCounter++;
    const loopStartTime = new Date(currentTime);

    if (addMinutes(currentTime, matchDuration) > END_OF_DAY) {
      break;
    }

    const availableCourts = courts.filter(c =>
      c.slots.some(({ start, end }) => start <= currentTime && addMinutes(currentTime, matchDuration) <= end) &&
      c.nextAvailable <= currentTime
    ).sort((a,b) => a.name.localeCompare(b.name));

    const readyMatches: Match[] = [];
    
    for (const matchId of unscheduled) {
        const m = matchesById.get(matchId)!;
        const reasons: string[] = [];

        const dependenciesMet = m.dependencies.every(depId => {
            const depMatch = matchesById.get(depId);
            const met = depMatch && !!depMatch.time;
            if (!met) reasons.push(`Dependência não resolvida: Jogo ${depId}.`);
            return met;
        });

        if (currentTime < (categoryStartTimes[m.category] || new Date(0))) {
          reasons.push(`Ainda não atingiu o horário de início da categoria (${formatDate(categoryStartTimes[m.category], 'HH:mm')}).`);
        }

        const canStart = !m.phaseStartTime || currentTime >= m.phaseStartTime;
        if (!canStart) {
           reasons.push(`Ainda não atingiu o horário mínimo da fase (${formatDate(m.phaseStartTime!, 'HH:mm')}).`);
        }

        const playersAvailable = m.players.every(p => {
          const available = (playerAvailability[p] || new Date(0)) <= currentTime;
          if (!available) reasons.push(`Jogador ${p} em descanso até ${formatDate(playerAvailability[p]!, 'HH:mm')}.`);
          return available;
        });

        const noConsecutive = m.players.every(p => {
          const consecutive = playedTwoConsecutive(p, currentTime);
          if (consecutive) reasons.push(`Jogador ${p} jogaria 3 partidas seguidas.`);
          return !consecutive;
        });

        if (reasons.length > 0) {
            logs.push({
                matchId: m.id,
                category: m.category,
                stage: m.stage,
                team1: m.team1,
                team2: m.team2,
                reasons: reasons,
                checkedAtTime: formatDate(currentTime, "HH:mm"),
            });
        }

        if (dependenciesMet && canStart && playersAvailable && noConsecutive) {
          readyMatches.push(m);
        }
    }

    readyMatches.sort((a, b) => {
      const stagePrioA = getStagePriority(a.stage);
      const stagePrioB = getStagePriority(b.stage);
      if (stagePrioA !== stagePrioB) return stagePrioB - stagePrioA;

      const catPrioA = categoryPlayoffPriority[a.category] ?? 999;
      const catPrioB = categoryPlayoffPriority[b.category] ?? 999;
      if (catPrioA !== catPrioB) return catPrioA - catPrioB;

      const rest = (m: Match) => {
        if (m.players.length === 0) return { min: Infinity, sum: Infinity };
        const rests = m.players.map(p => differenceInMinutes(currentTime, playerAvailability[p] || currentTime));
        return {
          min: Math.min(...rests),
          sum: rests.reduce((acc, val) => acc + val, 0)
        };
      };

      const ar = rest(a);
      const br = rest(b);
      return br.sum - ar.sum || br.min - ar.min;
    });

    const usedPlayers = new Set<string>();
    for (const court of availableCourts) {
        if(readyMatches.length === 0) {
          if (availableCourts.length > 0) {
                 logs.push({
                    matchId: `N/A-${court.name}-${formatDate(currentTime, "HHmm")}`,
                    category: "Sistema",
                    stage: "Alocação",
                    team1: "N/A",
                    team2: "N/A",
                    reasons: [`Quadra ${court.name} ficou livre, mas nenhum jogo está pronto para ser alocado. Verifique dependências ou descanso de jogadores.`],
                    checkedAtTime: formatDate(currentTime, "HH:mm"),
                });
            }
          break;
        };

        const matchIndex = readyMatches.findIndex(m => m.players.every(p => !usedPlayers.has(p)));
        if(matchIndex === -1) {
            if (availableCourts.length > 0) {
                 logs.push({
                    matchId: `N/A-${court.name}-${formatDate(currentTime, "HHmm")}`,
                    category: "Sistema",
                    stage: "Alocação",
                    team1: "N/A",
                    team2: "N/A",
                    reasons: [`Quadra ${court.name} ficou livre, mas todos os jogadores dos jogos prontos já estão em uso neste horário.`],
                    checkedAtTime: formatDate(currentTime, "HH:mm"),
                });
            }
            continue;
        };
        
        const match = readyMatches.splice(matchIndex, 1)[0];

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

    if (isEqual(currentTime, loopStartTime)) {
      currentTime = addMinutes(currentTime, matchDuration);
    }
  }

  if (unscheduled.size > 0 && addMinutes(currentTime, matchDuration) > END_OF_DAY) {
      for(const id of unscheduled){
          const match = matchesById.get(id)!;
          logs.push({
              matchId: match.id,
              category: match.category,
              stage: match.stage,
              team1: match.team1,
              team2: match.team2,
              reasons: ["Não há mais tempo disponível no dia para alocar a partida."],
              checkedAtTime: formatDate(currentTime, "HH:mm"),
          });
      }
  }

  const scheduledMatches = matches.filter(m => m.time && m.court);
  const unscheduledMatches = matches.filter(m => !m.time || !m.court);
  
  // Convert class instances to plain objects before returning, safe for Server->Client passing
  const plainPartialSchedule = matches.map(m => ({
    id: m.id,
    category: m.category,
    stage: m.stage,
    team1: m.team1,
    team2: m.team2,
    players: m.players,
    dependencies: m.dependencies,
    time: m.time,
    court: m.court,
    phaseStartTime: m.phaseStartTime ? formatDate(m.phaseStartTime, 'HH:mm') : undefined,
  }));


  return { scheduled: scheduledMatches, unscheduled: unscheduledMatches, logs, partialSchedule: plainPartialSchedule };
}
