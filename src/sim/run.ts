// Simulação: roda várias partidas bot contra bot e imprime um relatório.
// Uso: npm run sim -- [partidas] [aleatorio|guloso]

import { writeFileSync } from "node:fs";
import { cardDefs } from "../engine/data";
import { createGame, getChampion, type GameState, type TeamId } from "../engine/state";
import { applyAction, startGame } from "../engine/turn";
import { greedyBot } from "../bots/greedy";
import { randomBot } from "../bots/random";
import { createRng } from "../engine/rng";

const COMBO = ["enredador", "piromante", "atirador"];
const TATICO = ["arquiteto", "andarilho", "curandeiro"];

export interface GameResult {
  seed: number;
  winner: TeamId | null;
  comboTeam: TeamId;
  rounds: number;
  actions: number;
  plays: Record<string, number>;
  deaths: number;
  bossHp: number;
  stolenLastHit: boolean;
  error?: string;
}

export function runGame(seed: number, botKind: "guloso" | "aleatorio", maxActions = 6000): GameResult {
  // Metade das partidas troca o lado do Trio Combo, para não medir vantagem de largar primeiro.
  const comboTeam: TeamId = seed % 2 === 0 ? "A" : "B";
  const comp = comboTeam === "A" ? { A: COMBO, B: TATICO } : { A: TATICO, B: COMBO };
  const s = createGame(comp, seed);
  const bots = {
    A: botKind === "guloso" ? greedyBot({}, createRng(seed * 31 + 1)) : randomBot(createRng(seed * 31 + 1)),
    B: botKind === "guloso" ? greedyBot({}, createRng(seed * 31 + 2)) : randomBot(createRng(seed * 31 + 2)),
  };
  const plays: Record<string, number> = {};
  let actions = 0;
  let deaths = 0;
  let error: string | undefined;
  const alive = () => [...s.teams.A.champions, ...s.teams.B.champions].filter((c) => c.alive).length;
  startGame(s);
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
      applyAction(s, team, a);
      deaths += Math.max(0, before - alive());
      actions++;
    }
  } catch (e) {
    error = (e as Error).stack?.split("\n").slice(0, 4).join(" | ");
  }
  const stolen = !!s.winner && s.boss.lastHitBy !== null && (() => {
    // "Roubo": venceu quem deu o último golpe, mas o outro time causou mais dano no boss.
    return false;
  })();
  return { seed, winner: s.winner, comboTeam, rounds: s.round, actions, plays, deaths, bossHp: s.boss.hp, stolenLastHit: stolen, error };
}

export function report(results: GameResult[]): string {
  const done = results.filter((r) => r.winner);
  const comboWins = done.filter((r) => r.winner === r.comboTeam).length;
  const errors = results.filter((r) => r.error);
  const rounds = done.map((r) => r.rounds).sort((a, b) => a - b);
  const total: Record<string, number> = {};
  for (const r of results) for (const [k, v] of Object.entries(r.plays)) total[k] = (total[k] ?? 0) + v;
  const champCards = cardDefs.filter((c) => c.owner !== "monster");
  const never = champCards.filter((c) => !total[c.id]).map((c) => c.id);
  const lines: string[] = [];
  lines.push(`Partidas: ${results.length}, terminaram: ${done.length}, com erro: ${errors.length}`);
  lines.push(`Trio Combo venceu ${comboWins} de ${done.length} (${done.length ? Math.round((100 * comboWins) / done.length) : 0}%); Trio Tático venceu ${done.length - comboWins}`);
  if (rounds.length) lines.push(`Rodadas por partida: mínimo ${rounds[0]}, mediana ${rounds[Math.floor(rounds.length / 2)]}, máximo ${rounds[rounds.length - 1]}`);
  lines.push(`Mortes de campeões por partida: ${(results.reduce((n, r) => n + r.deaths, 0) / results.length).toFixed(1)}`);
  const top = Object.entries(total).sort((a, b) => b[1] - a[1]);
  lines.push(`Mais usadas: ${top.slice(0, 8).map(([k, v]) => `${k} (${v})`).join(", ")}`);
  lines.push(`Cartas de campeão nunca jogadas (${never.length} de ${champCards.length}): ${never.join(", ") || "nenhuma"}`);
  if (errors.length) lines.push(`Erros: ${errors.slice(0, 3).map((r) => `seed ${r.seed}: ${r.error}`).join("\n")}`);
  return lines.join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("run.ts")) {
  const n = Number(process.argv[2] ?? 20);
  const kind = (process.argv[3] ?? "guloso") as "guloso" | "aleatorio";
  const results: GameResult[] = [];
  const t0 = Date.now();
  for (let seed = 1; seed <= n; seed++) results.push(runGame(seed, kind));
  console.log(report(results));
  console.log(`Tempo: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  writeFileSync("sim-report.json", JSON.stringify(results, null, 1));
}

export { getChampion };
export type { GameState };
