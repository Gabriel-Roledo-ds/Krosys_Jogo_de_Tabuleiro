// Morte, retorno e vitória no motor hexagonal (roster v2) — igual a
// src/engine/death.ts, adaptado pro tabuleiro hexagonal e simplificado por
// enquanto: o motor v2 ainda não tem boss (ver KANBAN.md), então não existe a
// regra "morte vira definitiva quando o boss cai" do MVP — aqui toda morte é
// temporária (volta depois de outTurns, sempre). Revisar quando o boss v2
// entrar. Também não há cartas de besta/monstro ainda (recompensa do mapa
// novo é pessoal, não de equipe — ver claude/monstros-mapa.md), então a regra
// de "perder 1 carta de besta ao morrer" do MVP não se aplica aqui.

import { balance } from "../engine/data";
import { rngOf } from "../engine/rng";
import type { Hex } from "../design/hexGrid";
import { inHexBoard } from "../design/hexBoard";
import { allChampionsV2, logV2, type ChampionStateV2, type GameStateV2, type TeamId } from "./state";

/** Casa livre (dentro do tabuleiro, sem campeão vivo) entre as da área de largada da equipe, ou a mais próxima do centro dela. */
function freeStartCellV2(s: GameStateV2, startCells: Hex[]): Hex {
  const isFree = (p: { q: number; r: number }) =>
    inHexBoard(p, s.board) && !allChampionsV2(s).some((c) => c.alive && c.pos.q === p.q && c.pos.r === p.r);
  const free = startCells.find(isFree);
  if (free) return { ...free };
  return { ...startCells[0] }; // área lotada: usa a primeira mesmo assim (sem campeão sólido duplicado nunca deveria chegar aqui)
}

/** Campeão morre: some do tabuleiro, guarda a mão dele, só volta depois de `outTurns` turnos da própria equipe. */
export function killChampionV2(s: GameStateV2, c: ChampionStateV2): void {
  logV2(s, `${c.defId} (${c.team}) morreu`);
  c.alive = false;
  c.deaths += 1;
  c.outTurns = balance.death.turns_out_base + balance.death.extra_turns_per_previous_death * (c.deaths - 1);
  c.hp = 0;
  c.shield = 0;
  c.reflect = 0;
  c.reflectPercent = undefined;
  c.statuses = [];
  const team = s.teams[c.team];
  c.limbo = team.hand.filter((card) => card.owner === c.uid);
  team.hand = team.hand.filter((card) => card.owner !== c.uid);
}

/** Início do turno: campeões mortos da equipe voltam à largada, imunes até o fim do próprio turno, vida cheia, mão devolvida ao baralho. */
export function returnDeadChampionsV2(s: GameStateV2, team: TeamId, startCells: { q: number; r: number }[]): void {
  for (const c of s.teams[team].champions) {
    if (c.alive) continue;
    if (c.outTurns > 0) {
      c.outTurns -= 1;
      logV2(s, `${c.defId} (${team}) ainda está fora (${c.outTurns > 0 ? c.outTurns + " turno(s)" : "volta no próximo turno"})`);
      continue;
    }
    c.alive = true;
    c.hp = c.maxHp;
    c.pos = freeStartCellV2(s, startCells);
    c.untargetable = true;
    const deck = s.teams[team].decks[c.uid];
    deck.draw = rngOf(s).shuffle([...deck.draw, ...c.limbo]);
    c.limbo = [];
    logV2(s, `${c.defId} (${team}) volta à largada`);
  }
}

/** Vence quem deixar os 3 campeões inimigos fora de campo ao mesmo tempo. */
export function checkEliminationV2(s: GameStateV2, teamToFavorOnDoubleWipe: TeamId): void {
  if (s.winner) return;
  const wiped = (t: TeamId) => s.teams[t].champions.every((c) => !c.alive);
  const a = wiped("A");
  const b = wiped("B");
  if (!a && !b) return;
  const winner: TeamId = a && b ? teamToFavorOnDoubleWipe : a ? "B" : "A";
  s.winner = winner;
  logV2(s, `Todos os campeões da equipe ${winner === "A" ? "B" : "A"} caíram de uma vez. Vence a equipe ${winner}.`);
}

/** Mata todo campeão com hp <= 0 e checa eliminação. Chamado depois de qualquer dano. */
export function resolveDeathsV2(s: GameStateV2, teamToFavorOnDoubleWipe: TeamId): void {
  for (const c of allChampionsV2(s)) {
    if (c.alive && c.hp <= 0) killChampionV2(s, c);
  }
  checkEliminationV2(s, teamToFavorOnDoubleWipe);
}
