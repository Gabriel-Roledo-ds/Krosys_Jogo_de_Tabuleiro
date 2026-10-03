// Morte, retorno e vitória no motor hexagonal (roster v2) — igual a
// src/engine/death.ts, adaptado pro tabuleiro hexagonal. Com o boss v2 (item 6
// do KANBAN) chegou a regra do MVP: enquanto o boss está vivo, toda morte é
// temporária (volta depois de outTurns); quando ele cai, toda morte seguinte
// é definitiva (permaDead) e Ressurgir para de funcionar (ver
// resurrectBlockedV2 em cardPlay.ts). Também não há cartas de besta/monstro
// ainda (recompensa do mapa novo é pessoal, não de equipe — ver
// claude/monstros-mapa.md), então a regra de "perder 1 carta de besta ao
// morrer" do MVP não se aplica aqui.

import { balance } from "../engine/data";
import { rngOf } from "../engine/rng";
import { hexDistance, type Hex } from "../design/hexGrid";
import { inHexBoard, startAreaCells } from "../design/hexBoard";
import { dealDamageV2 } from "./damage";
import { addStatus, hasStatus, removeStatus, statusAmount } from "./status";
import { championsInRadius } from "./targeting";
import { allChampionsV2, logV2, nextIdV2, type ChampionStateV2, type GameStateV2, type TeamId } from "./state";

const startCellsForTeam = (s: GameStateV2, team: TeamId): Hex[] => startAreaCells(team === "A" ? "equipe_a" : "equipe_b", s.board);

/** Casa livre (dentro do tabuleiro, sem campeão vivo) entre as da área de largada da equipe, ou a mais próxima do centro dela. */
function freeStartCellV2(s: GameStateV2, startCells: Hex[]): Hex {
  const isFree = (p: { q: number; r: number }) =>
    inHexBoard(p, s.board) && !allChampionsV2(s).some((c) => c.alive && c.pos.q === p.q && c.pos.r === p.r);
  const free = startCells.find(isFree);
  if (free) return { ...free };
  return { ...startCells[0] }; // área lotada: usa a primeira mesmo assim (sem campeão sólido duplicado nunca deveria chegar aqui)
}

/**
 * Faz o campeão voltar ao campo agora: vida cheia (ou `hpPercent` dela),
 * largada livre, imune até o fim do próprio turno, mão devolvida ao baralho
 * e embaralhada. Usado tanto pelo retorno natural (`returnDeadChampionsV2`,
 * depois de `outTurns`) quanto por `resurrect` (Ressurgir da Selene, item 5
 * do KANBAN), que chama isso na hora, pulando a espera.
 */
export function reviveChampionV2(s: GameStateV2, c: ChampionStateV2, hpPercent = 100): void {
  const team = s.teams[c.team];
  c.alive = true;
  c.hp = Math.max(1, Math.round((c.maxHp * hpPercent) / 100));
  c.outTurns = 0;
  c.pos = freeStartCellV2(s, startCellsForTeam(s, c.team));
  c.untargetable = true;
  const deck = team.decks[c.uid];
  deck.draw = rngOf(s).shuffle([...deck.draw, ...c.limbo]);
  c.limbo = [];
  logV2(s, `${c.defId} (${c.team}) volta ao campo com ${hpPercent}% de vida`);
}

/**
 * Campeão morre: some do tabuleiro, guarda a mão dele, só volta depois de
 * `outTurns` turnos da própria equipe. Antes de matar de verdade, checa
 * `death_ward` (Fênix Momentânea da Ignira): se o campeão tiver o status,
 * ele é consumido — o campeão sobrevive com 1hp e explode dano na área ao
 * redor (fogo amigo incluso, mesma regra de área de effects.ts).
 */
export function killChampionV2(s: GameStateV2, c: ChampionStateV2): void {
  if (hasStatus(c, "death_ward")) {
    const amount = statusAmount(c, "death_ward");
    const radius = c.statuses.find((x) => x.status === "death_ward")?.radius ?? 0;
    removeStatus(c, "death_ward");
    c.hp = 1;
    logV2(s, `${c.defId} (${c.team}) sobrevive com a Fênix Momentânea e explode`);
    for (const target of championsInRadius(s, c.pos, radius, { excludeUid: c.uid })) {
      dealDamageV2(c, target, amount);
    }
    return;
  }
  // Marca do Predador ★★★ da Niara (jump_to_nearest_enemy_on_target_death,
  // ver effects.ts applyJumpToNearestEnemyOnTargetDeath): o status "mark"
  // marcado com jumpOnDeath salta pro inimigo vivo mais próximo do campeão
  // que está morrendo agora, ANTES de limpar os status dele mais abaixo —
  // "inimigo" aqui é do ponto de vista de quem lançou a marca originalmente
  // (a Niara/seu time): a marca sempre persegue o MESMO time de quem está
  // morrendo (quem morreu era um inimigo da Niara, e o próximo alvo também
  // precisa ser), nunca salta pro lado da própria Niara.
  const jumpingMark = c.statuses.find((st) => st.status === "mark" && st.jumpOnDeath);
  if (jumpingMark) {
    const nearest = allChampionsV2(s)
      .filter((u) => u.alive && u.team === c.team && u.uid !== c.uid)
      .sort((a, b) => hexDistance(a.pos, c.pos) - hexDistance(b.pos, c.pos) || a.uid.localeCompare(b.uid))[0];
    if (nearest) {
      addStatus(nearest, nextIdV2(s), "mark", jumpingMark.unit, jumpingMark.remaining, {
        amount: jumpingMark.amount,
        negative: jumpingMark.negative,
        jumpOnDeath: true,
      });
      logV2(s, `Marca do Predador salta de ${c.defId} (morto) pra ${nearest.defId} (${nearest.team})`);
    }
  }

  logV2(s, `${c.defId} (${c.team}) morreu`);
  c.alive = false;
  c.deaths += 1;
  if (!s.boss.alive) {
    c.permaDead = true;
    c.outTurns = 0;
    logV2(s, `${c.defId} (${c.team}) morreu de vez (Boss já caiu)`);
  } else {
    c.outTurns = balance.death.turns_out_base + balance.death.extra_turns_per_previous_death * (c.deaths - 1);
  }
  c.hp = 0;
  c.shield = 0;
  c.reflect = 0;
  c.reflectPercent = undefined;
  c.statuses = [];
  const team = s.teams[c.team];
  c.limbo = team.hand.filter((card) => card.owner === c.uid);
  team.hand = team.hand.filter((card) => card.owner !== c.uid);
}

/** Início do turno: campeões mortos da equipe voltam à largada, imunes até o fim do próprio turno, vida cheia, mão devolvida ao baralho. Quem morreu de vez (Boss já caiu) não volta. */
export function returnDeadChampionsV2(s: GameStateV2, team: TeamId): void {
  for (const c of s.teams[team].champions) {
    if (c.alive || c.permaDead) continue;
    if (c.outTurns > 0) {
      c.outTurns -= 1;
      logV2(s, `${c.defId} (${team}) ainda está fora (${c.outTurns > 0 ? c.outTurns + " turno(s)" : "volta no próximo turno"})`);
      continue;
    }
    reviveChampionV2(s, c, 100);
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

/**
 * Boss cai: perde a recompensa de dano x2, para de ativar. Dali em diante toda
 * morte de campeão (`killChampionV2`) passa a ser definitiva. Chamado antes de
 * resolver as mortes, igual ao MVP (src/engine/death.ts).
 */
export function resolveBossDeathV2(s: GameStateV2): void {
  if (!s.boss.alive || s.boss.hp > 0) return;
  s.boss.alive = false;
  s.boss.hp = 0;
  s.bountyTeam = null;
  logV2(s, "O Boss cai! Daqui em diante as mortes de campeões são definitivas.");
}

/** Mata o boss (se caiu), todo campeão com hp <= 0, e checa eliminação. Chamado depois de qualquer dano. */
export function resolveDeathsV2(s: GameStateV2, teamToFavorOnDoubleWipe: TeamId): void {
  resolveBossDeathV2(s);
  for (const c of allChampionsV2(s)) {
    if (c.alive && c.hp <= 0) killChampionV2(s, c);
  }
  checkEliminationV2(s, teamToFavorOnDoubleWipe);
}
