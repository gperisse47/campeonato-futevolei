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
  priority: number;
  slots: CourtSlot[];
  nextAvailable: Date = new Date(0);

  constructor(name: string, slots: [string, string][], priority?: number) {
    this.name = name;
    this.slots = slots.map(([start, end]) => ({
      start: parseDate(start, "HH:mm", new Date()),
      end: parseDate(end, "HH:mm", new Date())
    }));
    this.priority = priority ?? 99;
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
    
    // Find the correct phase start time by checking if the stage name starts with the key.
    // This handles "Semifinal 1" and "Semifinal 2" matching a "Semifinal" key.
    if (this.stage) {
      for (const key in parameters) {
          const match = key.match(/__(stageMinTime)_(.+)/);
          if (match && this.stage.startsWith(match[2]) && key.startsWith(this.category)) {
              const timeValue = parameters[key];
              if (timeValue) {
                  this.phaseStartTime = parseDate(timeValue, "HH:mm", new Date());
                  break; // Found the most specific match
              }
          }
      }
    }
  }

  private extractPlayers(team: string): string[] {
    if (!team || !team.includes(' e ')) return [];
    return team.split(/\s+e\s+/).map(p => p.trim()).filter(Boolean);
  }
}

function getStagePriority(stage: string): number {
    if (!stage) return 50; // Default priority for undefined stages
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
       let priority: number | undefined;

      Object.entries(parameters).forEach(([kk, vv]) => {
        const slotMatch = kk.match(new RegExp(`court_${courtId}_slot_\\d+`));
        if (slotMatch) {
          const [start, end] = vv.split("-").map(s => s.trim());
          slots.push([start, end]);
        }
        const priorityMatch = kk.match(new RegExp(`court_${courtId}_priority`));
        if (priorityMatch) {
            priority = parseInt(vv, 10);
        }
      });
      courts.push(new Court(name, slots, priority));
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
  let currentTime = new Date(Math.min(...Object.values(categoryStartTimes).map(d => d ? d.getTime() : Infinity).filter(isFinite), END_OF_DAY.getTime()));
  const unscheduled = new Set(matches.map(m => m.id));
  const logs: SchedulingLog[] = [];


  function playedTwoConsecutive(player: string, time: Date): boolean {
    const times = (matchHistory[player] || []).filter(t => t < time).sort((a, b) => a.getTime() - b.getTime());
    if (times.length < 2) return false;

    const lastMatchTime = times[times.length - 1];
    const secondLastMatchTime = times[times.length - 2];
    
    const diffLast = differenceInMinutes(time, lastMatchTime);
    if(diffLast !== matchDuration) return false;
    
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
    ).sort((a,b) => (a.priority ?? 99) - (b.priority ?? 99));

    const readyMatches: Match[] = [];
    
    const eligibleCategories = Object.keys(categoryStartTimes)
        .filter(cat => currentTime >= (categoryStartTimes[cat] || new Date(8640000000000000))) // Filter out categories that haven't started
        .sort((a, b) => {
            const prioA = categoryPlayoffPriority[a] ?? 999;
            const prioB = categoryPlayoffPriority[b] ?? 999;
            return prioA - prioB;
        });
        
    for (const m of matches) {
      if (!unscheduled.has(m.id)) continue;
      if (!eligibleCategories.includes(m.category)) continue;

      const reasons: string[] = [];
      
      const dependenciesMet = m.dependencies.every(depId => {
          const depMatch = matchesById.get(depId);
          const met = depMatch && !!depMatch.time;
          if (!met) reasons.push(`Dependência não resolvida: Jogo ${depId}.`);
          return met;
      });

      const phaseStartTimeMet = !m.phaseStartTime || currentTime >= m.phaseStartTime;
      if (!phaseStartTimeMet) {
          reasons.push(`Ainda não atingiu o horário mínimo da fase (${formatDate(m.phaseStartTime!, 'HH:mm')}).`);
      }

      const playersAvailable = m.players.every(p => {
        const availableTime = playerAvailability[p] || new Date(0);
        const available = availableTime <= currentTime;
        if (!available) reasons.push(`Jogador ${p} em descanso até ${formatDate(availableTime, 'HH:mm')}.`);
        return available;
      });

      const noConsecutive = m.players.every(p => {
        const consecutive = playedTwoConsecutive(p, currentTime);
        if (consecutive) reasons.push(`Jogador ${p} jogaria 3 partidas seguidas.`);
        return !consecutive;
      });

      if (dependenciesMet && phaseStartTimeMet && playersAvailable && noConsecutive) {
        readyMatches.push(m);
      } else {
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
    }


    readyMatches.sort((a, b) => {
      // Prioridade #1: Fase do Jogo (Final > Semi > Quartas)
      const stagePrioA = getStagePriority(a.stage);
      const stagePrioB = getStagePriority(b.stage);
      if (a.category !== b.category){
        if (stagePrioA !== stagePrioB) return stagePrioB - stagePrioA;}
        else
        {if (stagePrioA !== stagePrioB) return stagePrioA - stagePrioB;}
    
      // Prioridade #2: Prioridade da Categoria (menor é melhor)
      const catPrioA = categoryPlayoffPriority[a.category] ?? 999;
      const catPrioB = categoryPlayoffPriority[b.category] ?? 999;
      if (catPrioA !== catPrioB) return catPrioA - catPrioB;

      const rest = (m: Match) => {
        if (m.players.length === 0) return { min: Infinity, sum: Infinity };
        const rests = m.players.map(p => {
            const pa = playerAvailability[p] || new Date(0);
            return differenceInMinutes(currentTime, pa);
        });
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
    // 1. Ordena quadras por prioridade (menor número = maior prioridade)
    const sortedCourts = [...availableCourts].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

    // 2. Seleciona até N partidas disponíveis cujos jogadores ainda não foram usados neste horário
    const candidateMatches: Match[] = [];
    const tempUsedPlayers = new Set<string>();

    for (const match of readyMatches) {
      if (candidateMatches.length >= sortedCourts.length) break;
      if (match.players.every(p => !tempUsedPlayers.has(p))) {
        candidateMatches.push(match);
        match.players.forEach(p => tempUsedPlayers.add(p));
      }
    }

    // 3. Ordena essas partidas por prioridade de fase (maior prioridade primeiro)
    candidateMatches.sort((a, b) => getStagePriority(b.stage) - getStagePriority(a.stage));
    const topPriority = Math.min(...sortedCourts.map(court => court.priority ?? 99));
    

    // 4. Aloca as melhores partidas nas melhores quadras
    for (let i = 0; i < Math.min(sortedCourts.length, candidateMatches.length); i++) {
      const court = sortedCourts[i];
      const isTopCourt =  (court.priority ?? 99) === topPriority;

      //const match = candidateMatches[i];
      //match.time = formatDate(currentTime, "HH:mm");
      //match.court = court.name;
      //court.nextAvailable = addMinutes(currentTime, matchDuration);

      //for (const p of match.players) {
            //playerAvailability[p] = addMinutes(currentTime, matchDuration);
            //if (!matchHistory[p]) matchHistory[p] = [];
            //matchHistory[p].push(currentTime);
            //usedPlayers.add(p);
        //}
      //unscheduled.delete(match.id);
      // Tenta alocar partidas de playoffs (mata-mata) primeiro
      let match = candidateMatches.find(m => {
        const isPlayoffStage = getStagePriority(m.stage) > 1; // Verifica se é uma partida de playoffs (mata-mata)
        return isPlayoffStage && !m.time && !m.court && isTopCourt; // Apenas partidas não alocadas
      });
      
      if (!match) {
        // Caso não encontre uma partida de playoffs disponível, tenta alocar uma fase de grupos
        match = candidateMatches.find(m => {
          const isGroupStage = getStagePriority(m.stage) <= 1; // Fase de grupos tem prioridade menor
          return isGroupStage && !m.time && !m.court; // Apenas partidas não alocadas
        });
      }
    
      if (match) {
        // Aloca a partida encontrada
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
    }

    // // === 4) Alocação usando candidateMatches já filtrado e ordenado ===

    // // helper: playoff = getStagePriority(stage) > 1 (ajuste se necessário)
    // const isPlayoff = (m: Match) => getStagePriority(m.stage) > 1;
    
    // // menor número = maior prioridade (já ordenado asc em sortedCourts)
    // const topPriority = sortedCourts[0]?.priority ?? 99;
    // const isTopCourt = (c: Court) => (c.priority ?? 99) === topPriority;
    
    // // controla para não repetir a mesma partida em múltiplas quadras no mesmo tick
    // const usedMatchIds = new Set<string>();
    
    // for (let i = 0; i < Math.min(sortedCourts.length, candidateMatches.length); i++) {
    //   const court = sortedCourts[i];
    
    //   let match: Match | undefined;
    
    //   if (isTopCourt(court)) {
    //     // Quadra top: tenta playoff primeiro (na ORDEM já existente de candidateMatches)
    //     match = candidateMatches.find(m => !usedMatchIds.has(m.id) && isPlayoff(m));
    //     // Se não há playoff sobrando, cai para fase de grupos
    //     if (!match) {
    //       match = candidateMatches.find(m => !usedMatchIds.has(m.id) && !isPlayoff(m));
    //     }
    //   } else {
    //     // Quadra não-top: apenas grupos (mesmo que existam playoffs)
    //     match = candidateMatches.find(m => !usedMatchIds.has(m.id) && !isPlayoff(m));
    //   }
    
    //   if (!match) continue;
    
    //   usedMatchIds.add(match.id);
    
    //   // --- bloco original de alocação ---
    //   match.time = formatDate(currentTime, "HH:mm");
    //   match.court = court.name;
    //   court.nextAvailable = addMinutes(currentTime, matchDuration);
    
    //   for (const p of match.players) {
    //     playerAvailability[p] = addMinutes(currentTime, matchDuration);
    //     if (!matchHistory[p]) matchHistory[p] = [];
    //     matchHistory[p].push(currentTime);
    //     usedPlayers.add(p);
    //   }
    //   unscheduled.delete(match.id);
    // }

    
    if (isEqual(currentTime, loopStartTime)) {
      currentTime = addMinutes(currentTime, matchDuration);
    } else {
      currentTime = loopStartTime;
    }
  }

  if (unscheduled.size > 0 && addMinutes(currentTime, matchDuration) > END_OF_DAY) {
      for(const id of unscheduled){
          const match = matchesById.get(id)!;
          if (!logs.some(l => l.matchId === id && l.reasons.some(r => r.startsWith("Não há mais tempo")))) {
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
  }

  const scheduledMatches = matches.filter(m => m.time && m.court);
  const unscheduledMatches = matches.filter(m => !m.time || !m.court);
  
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
