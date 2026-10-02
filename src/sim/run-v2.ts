// Simulação do motor hexagonal (roster v2): roda várias partidas bot contra bot e
// imprime um relatório. Mesma ideia de src/sim/run.ts (MVP), adaptada pro turno/ações
// v2. Uso: npx tsx src/sim/run-v2.ts [partidas] [aleatorio|guloso]

import { writeFileSync } from "node:fs";
import { cardsV2 } from "../engine-v2/data";
import { createGameV2, type GameStateV2, type TeamId } from "../engine-v2/state";
import { applyActionV2, startGameV2 } from "../engine-v2/turn";
import { greedyBotV2 } from "../bots-v2/greedy";
import { randomBotV2 } from "../bots-v2/random";
import { createRng } from "../engine/rng";

const TEAM_1 = ["niara", "varek", "selene"];
const TEAM_2 = ["borak", "dorin", "aurelia"];

export interface GameResultV2 {
  seed: number;
  winner: TeamId | null;
  team1Side: TeamId;
  rounds: number;
  actions: number;
  plays: Record<string, number>;
  deaths: number;
  bossHp: number;
  monstersKilled: number;
  error?: string;
}

export function runGameV2(seed: number, botKind: "guloso" | "aleatorio", maxActions = 8000): GameResultV2 {
  // Metade das partidas troca o lado do TEAM_1, para não medir vantagem de largar primeiro.
  const team1Side: TeamId = seed % 2 === 0 ? "A" : "B";
  const comp = team1Side === "A" ? { A: TEAM_1, B: TEAM_2 } : { A: TEAM_2, B: TEAM_1 };
  const s = createGameV2(seed, { comp });
  const bots = {
    A: botKind === "guloso" ? greedyBotV2({}, createRng(seed * 31 + 1)) : randomBotV2(createRng(seed * 31 + 1)),
    B: botKind === "guloso" ? greedyBotV2({}, createRng(seed * 31 + 2)) : randomBotV2(createRng(seed * 31 + 2)),
  };
  const plays: Record<string, number> = {};
  let actions = 0;
  let deaths = 0;
  let error: string | undefined;
  const alive = () => [...s.teams.A.champions, ...s.teams.B.champions].filter((c) => c.alive).length;
  startGameV2(s);
  try {
    while (!s.winner && actions < maxActions) {
      const team: TeamId = s.pending ? s.pending.priority : s.turn.team;
      const a = bots[team](s, team);
      if (a.type === "play") {
        const card = s.teams[team].hand.find((c) => c.uid === a.card);
        if (card) plays[card.cardId] = (plays[card.cardId] ?? 0) + 1;
      }
      if (a.type === "basic") plays["basic"] = (plays["basic"] ?? 0) + 1;
      const before = alive();
      applyActionV2(s, team, a);
      deaths += Math.max(0, before - alive());
      actions++;
    }
  } catch (e) {
    error = (e as Error).stack?.split("\n").slice(0, 4).join(" | ");
  }
  const monstersKilled = s.monsters.filter((m) => !m.alive).length;
  return { seed, winner: s.winner, team1Side, rounds: s.round, actions, plays, deaths, bossHp: Math.max(0, s.boss.hp), monstersKilled, error };
}

export function reportV2(results: GameResultV2[]): string {
  const done = results.filter((r) => r.winner);
  const team1Wins = done.filter((r) => r.winner === r.team1Side).length;
  const errors = results.filter((r) => r.error);
  const rounds = done.map((r) => r.rounds).sort((a, b) => a - b);
  const total: Record<string, number> = {};
  for (const r of results) for (const [k, v] of Object.entries(r.plays)) total[k] = (total[k] ?? 0) + v;
  const champCards = cardsV2;
  const never = champCards.filter((c) => !total[c.id]).map((c) => c.id);
  const lines: string[] = [];
  lines.push(`Partidas: ${results.length}, terminaram: ${done.length}, com erro: ${errors.length}`);
  lines.push(`Time 1 (niara/varek/selene) venceu ${team1Wins} de ${done.length} (${done.length ? Math.round((100 * team1Wins) / done.length) : 0}%); Time 2 venceu ${done.length - team1Wins}`);
  if (rounds.length) lines.push(`Rodadas por partida: mínimo ${rounds[0]}, mediana ${rounds[Math.floor(rounds.length / 2)]}, máximo ${rounds[rounds.length - 1]}`);
  lines.push(`Mortes de campeões por partida: ${(results.reduce((n, r) => n + r.deaths, 0) / results.length).toFixed(1)}`);
  lines.push(`Monstros derrotados por partida: ${(results.reduce((n, r) => n + r.monstersKilled, 0) / results.length).toFixed(1)}`);
  const top = Object.entries(total).sort((a, b) => b[1] - a[1]);
  lines.push(`Mais usadas: ${top.slice(0, 8).map(([k, v]) => `${k} (${v})`).join(", ")}`);
  lines.push(`Cartas de campeão nunca jogadas (${never.length} de ${champCards.length}): ${never.join(", ") || "nenhuma"}`);
  if (errors.length) lines.push(`Erros: ${errors.slice(0, 3).map((r) => `seed ${r.seed}: ${r.error}`).join("\n")}`);
  return lines.join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("run-v2.ts")) {
  const n = Number(process.argv[2] ?? 20);
  const kind = (process.argv[3] ?? "guloso") as "guloso" | "aleatorio";
  const results: GameResultV2[] = [];
  const t0 = Date.now();
  for (let seed = 1; seed <= n; seed++) results.push(runGameV2(seed, kind));
  console.log(reportV2(results));
  console.log(`Tempo: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  writeFileSync("sim-report-v2.json", JSON.stringify(results, null, 1));
}

export type { GameStateV2 };
