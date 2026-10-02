// Fluxo do turno do motor hexagonal (roster v2) — equivalente a
// src/engine/turn.ts, adaptado pro tabuleiro hexagonal e pra carta por rank
// (cardPlay.ts). Fecha o item 4 da ordem de execução em KANBAN.md: junta
// compra, dado de movimento, básica/cartas (com pilha de respostas rápidas),
// descarte e alternância A/B num turno de verdade.
//
// Simplificações assumidas nesta primeira versão (documentadas, não
// silenciosas — ver KANBAN.md):
// - Sem boss v2 ainda: o turno começa direto na fase de compra, sem a fase 0
//   que o MVP tem pra ativação do boss.
// - Silêncio/atordoamento não bloqueiam cartas/básicas aqui: esses status já
//   existem no catálogo de effects.ts mas ainda não há a checagem
//   cannotCast/cannotBasic do MVP ligada ao turno v2.
// - Sem efeitos de "pisar na casa" (onLand/hazards) — paredes/estruturas
//   fixas do pós-MVP ainda não têm esse gancho no motor v2.
// - Sem "Passo Ágil"/bônus de mana por distância andada (nenhuma carta v2
//   usa isso hoje; se alguma vier a usar, entra junto).

import { balance } from "../engine/data";
import { basicTargetV2, getCardDefV2, getCardRankV2, getChampionDefV2 } from "./data";
import { startAreaCells } from "../design/hexBoard";
import type { Hex } from "../design/hexGrid";
import { hexKey } from "../design/hexGrid";
import { discardCardV2, deckSizeV2, drawFromV2 } from "./deck";
import { resolveDeathsV2, returnDeadChampionsV2 } from "./death";
import { IllegalActionV2, rankRangeV2, resolveBasicEffectsV2, resolveCardEffectsV2 } from "./cardPlay";

export { IllegalActionV2 };
import { canPayV2, gainTurnManaV2, spendManaV2 } from "./mana";
import { movementBudgetV2, reachableMap, rollMovementDie } from "./movement";
import { expireChampionTurnStatuses, tickRoundV2 } from "./tick";
import {
  getChampionV2,
  logV2,
  newTurnV2,
  otherTeam,
  type CardInstanceV2,
  type ChampionStateV2,
  type GameStateV2,
  type StackItemV2,
  type TeamId,
} from "./state";
import { enumerateTargetsV2, validateTargetV2, type TargetV2 } from "./targeting";

export type ActionV2 =
  | { type: "draw"; champion: string }
  | { type: "skipDraw" }
  | { type: "move"; to: Hex; champion?: string }
  | { type: "stay"; champion: string }
  | { type: "play"; card: string; rank: number; target: TargetV2 }
  | { type: "basic"; target: TargetV2; champion?: string }
  | { type: "pass" }
  | { type: "discard"; card: string }
  | { type: "end" };

function fail(msg: string): never {
  throw new IllegalActionV2(msg);
}

const startCellsFor = (team: TeamId, game: GameStateV2): Hex[] => startAreaCells(team === "A" ? "equipe_a" : "equipe_b", game.board);

/** Começa a partida: primeiro turno da equipe A. */
export function startGameV2(game: GameStateV2): void {
  beginTurn(game);
}

function beginTurn(game: GameStateV2): void {
  const team = game.turn.team;
  returnDeadChampionsV2(game, team, startCellsFor(team, game));
  logV2(game, `Turno da equipe ${team} (rodada ${game.round})`);
  enterDrawPhase(game);
}

function enterDrawPhase(game: GameStateV2): void {
  const team = game.turn.team;
  const tm = game.teams[team];
  const anyCards = tm.champions.some((c) => c.alive && deckSizeV2(game, c.uid) > 0);
  if (!anyCards) {
    gainTurnManaV2(game, team);
    startAct(game);
    return;
  }
  game.turn.phase = "draw";
}

function startAct(game: GameStateV2): void {
  const t = game.turn;
  t.phase = "act";
  t.die = rollMovementDie(game);
  logV2(game, `Dado do turno: ${t.die}`);
}

function activate(game: GameStateV2, c: ChampionStateV2): void {
  const t = game.turn;
  t.activated.push(c.uid);
  t.main = c.uid;
  t.movementLeft = movementBudgetV2(c, t.die);
  logV2(game, `${c.defId} (${c.team}) usa o movimento do turno (até ${t.movementLeft} casas)`);
}

// ---------- pilha de respostas rápidas ----------

/** Jogadas rápidas possíveis pra equipe agora (cartas com `fast`, pagáveis, com pelo menos 1 alvo válido). */
export function fastPlaysV2(game: GameStateV2, team: TeamId, cap = 20): { card: CardInstanceV2; rank: number; target: TargetV2 }[] {
  const out: { card: CardInstanceV2; rank: number; target: TargetV2 }[] = [];
  for (const card of game.teams[team].hand) {
    const def = getCardDefV2(card.cardId);
    if (!def.fast) continue;
    const owner = getChampionV2(game, card.owner);
    if (!owner.alive) continue;
    for (const rank of def.ranks) {
      if (out.length >= cap) break;
      if (!canPayV2(game, team, rank.cost)) continue;
      for (const target of enumerateTargetsV2(game, owner, { range: rankRangeV2(rank), target: def.target })) {
        if (out.length >= cap) break;
        out.push({ card, rank: rank.rank, target });
      }
    }
  }
  return out;
}

/** Alguém dessa equipe pode responder agora com uma carta rápida? */
export const canRespondV2 = (game: GameStateV2, team: TeamId): boolean => fastPlaysV2(game, team, 1).length > 0;

function settlePriorityV2(game: GameStateV2, first: TeamId): void {
  const p = game.pending!;
  if (p.chain < balance.fast_cards.max_chained_responses && canRespondV2(game, first)) {
    p.priority = first;
    return;
  }
  resolveStackV2(game);
}

function resolveStackV2(game: GameStateV2): void {
  const p = game.pending;
  if (!p) return;
  while (p.stack.length > 0) {
    const item = p.stack.pop()!;
    const owner = getChampionV2(game, item.owner);
    if (!owner.alive) {
      logV2(game, `${item.owner} não está em campo: a ação falha`);
      continue;
    }
    if (item.kind === "card") {
      const def = getCardDefV2(item.cardId);
      const rank = getCardRankV2(def, item.rank);
      resolveCardEffectsV2(game, owner, def, rank, item.target, item.buff?.bonusDamage);
    } else {
      resolveBasicEffectsV2(game, owner, getChampionDefV2(owner.defId).basic, item.target);
    }
  }
  game.pending = null;
  resolveDeathsV2(game, game.turn.team);
}

function pushItemV2(game: GameStateV2, item: StackItemV2): void {
  if (!game.pending) game.pending = { stack: [item], priority: otherTeam(item.team), chain: 0 };
  else {
    game.pending.stack.push(item);
    game.pending.chain += 1;
  }
  settlePriorityV2(game, otherTeam(item.team));
}

// ---------- jogar carta (valida + paga agora, resolve quando a pilha esvaziar) ----------

function commitCardV2(game: GameStateV2, team: TeamId, cardUid: string, rankNumber: number, t: TargetV2, isResponse: boolean): void {
  if (!isResponse && game.turn.phase !== "act") fail("Não é a fase de ação");
  const hand = game.teams[team].hand;
  const cardInstance = hand.find((c) => c.uid === cardUid);
  if (!cardInstance) fail("Carta não está na mão");
  const def = getCardDefV2(cardInstance.cardId);
  if (isResponse && !def.fast) fail("Só cartas rápidas respondem");
  const owner = getChampionV2(game, cardInstance.owner);
  if (!owner.alive) fail("O dono da carta não está em campo");
  const rank = getCardRankV2(def, rankNumber);

  const err = validateTargetV2(game, owner, { range: rankRangeV2(rank), target: def.target }, t);
  if (err) fail(err);
  if (!canPayV2(game, team, rank.cost)) fail("Mana insuficiente");

  const buff = game.teams[team].nextCardBuff ?? undefined;
  spendManaV2(game, team, rank.cost);
  game.teams[team].hand = hand.filter((c) => c.uid !== cardUid);
  discardCardV2(game, cardInstance);
  if (buff && !rank.effects.some((e) => e.type === "buff_next_card")) game.teams[team].nextCardBuff = null;

  logV2(game, `${owner.defId} (${team}) joga ${def.name} (rank ${rankNumber})`);
  pushItemV2(game, { kind: "card", team, owner: owner.uid, cardId: cardInstance.cardId, rank: rankNumber, target: t, buff });
}

// ---------- ações ----------

/** Aplica a ação de uma equipe. Lança IllegalActionV2 se não for permitida. */
export function applyActionV2(game: GameStateV2, team: TeamId, a: ActionV2): void {
  if (game.winner) fail("A partida já terminou");

  // Janela de resposta: só a equipe com prioridade age (carta rápida ou passar).
  if (game.pending) {
    if (game.pending.priority !== team) fail("Não é a sua vez de responder");
    if (a.type === "pass") {
      resolveStackV2(game);
      return;
    }
    if (a.type !== "play") fail("Responda com uma carta rápida ou passe");
    commitCardV2(game, team, a.card, a.rank, a.target, true);
    return;
  }

  if (game.turn.team !== team) fail("Não é o seu turno");
  const t = game.turn;
  const tm = game.teams[team];

  switch (a.type) {
    case "draw": {
      if (t.phase !== "draw") fail("Não é a fase de compra");
      const c = getChampionV2(game, a.champion);
      if (c.team !== team || !c.alive) fail("Campeão inválido");
      const n = tm.turnsTaken === 0 ? balance.hand.first_turn_draw : balance.hand.draw_per_turn;
      if (drawFromV2(game, a.champion, n) === 0) fail("Esse baralho está vazio");
      gainTurnManaV2(game, team);
      startAct(game);
      return;
    }
    case "skipDraw": {
      if (t.phase !== "draw") fail("Não é a fase de compra");
      if (tm.hand.length < balance.hand.max_size) fail("Só dá para não comprar com a mão cheia");
      logV2(game, `Equipe ${team} não compra carta (mão cheia)`);
      gainTurnManaV2(game, team);
      startAct(game);
      return;
    }
    case "stay": {
      if (t.phase !== "act") fail("Não é a fase de ação");
      const c = getChampionV2(game, a.champion);
      if (c.team !== team || !c.alive) fail("Campeão inválido");
      if (t.activated.includes(c.uid)) fail("Esse campeão já gastou o movimento");
      activate(game, c);
      logV2(game, `${c.defId} (${c.team}) gasta o movimento parado`);
      return;
    }
    case "move": {
      if (t.phase !== "act") fail("Não é a fase de ação");
      const c = a.champion ? getChampionV2(game, a.champion) : t.main ? getChampionV2(game, t.main) : fail("Escolha um campeão para mover");
      if (c.team !== team || !c.alive) fail("Campeão inválido");
      const isActive = t.main === c.uid;
      if (!isActive && t.activated.includes(c.uid)) fail("Esse campeão já se moveu neste turno");
      const budget = isActive ? t.movementLeft : movementBudgetV2(c, t.die);
      const hit = reachableMap(game, c, budget).get(hexKey(a.to));
      if (!hit) fail("Movimento inválido");
      if (!isActive) activate(game, c);
      t.movementLeft -= hit.cost;
      c.pos = { ...a.to };
      logV2(game, `${c.defId} (${c.team}) anda até (${a.to.q},${a.to.r})`);
      return;
    }
    case "play":
      commitCardV2(game, team, a.card, a.rank, a.target, false);
      return;
    case "basic": {
      if (t.phase !== "act") fail("Não é a fase de ação");
      const c = a.champion ? getChampionV2(game, a.champion) : t.main ? getChampionV2(game, t.main) : fail("Escolha um campeão para a básica");
      if (c.team !== team || !c.alive) fail("Campeão inválido");
      if (t.basicUsed.includes(c.uid)) fail("Esse campeão já usou a habilidade básica neste turno");
      const basic = getChampionDefV2(c.defId).basic;
      const err = validateTargetV2(game, c, { range: basic.range, target: basicTargetV2(basic) }, a.target);
      if (err) fail(err);
      t.basicUsed.push(c.uid);
      logV2(game, `${c.defId} (${c.team}) usa ${basic.name}`);
      pushItemV2(game, { kind: "basic", team, owner: c.uid, cardId: `basic:${c.defId}`, rank: 0, target: a.target });
      return;
    }
    case "discard": {
      if (t.phase !== "discard") fail("Não é preciso descartar");
      const card = tm.hand.find((c) => c.uid === a.card);
      if (!card) fail("Carta inválida para descarte");
      tm.hand = tm.hand.filter((c) => c.uid !== a.card);
      discardCardV2(game, card);
      if (tm.hand.length <= balance.hand.max_size) finishTurn(game);
      return;
    }
    case "end": {
      if (t.phase !== "act") fail("Não é a fase de ação");
      if (tm.hand.length > balance.hand.max_size) {
        t.phase = "discard";
        return;
      }
      finishTurn(game);
      return;
    }
    case "pass":
      fail("Não há nada para passar");
  }
}

function finishTurn(game: GameStateV2): void {
  const t = game.turn;
  const tm = game.teams[t.team];
  for (const uid of t.activated) expireChampionTurnStatuses(getChampionV2(game, uid));
  for (const c of tm.champions) c.untargetable = false;
  tm.turnsTaken += 1;
  tm.nextCardBuff = null;
  const next = otherTeam(t.team);
  if (t.team === "B") {
    tickRoundV2(game);
    if (game.winner) return;
    game.round += 1;
  }
  game.turn = newTurnV2(next, "draw");
  beginTurn(game);
}

/** Ações legais agora, pra bots e pra interface listar o que dá pra fazer. */
export function legalActionsV2(game: GameStateV2, team: TeamId): ActionV2[] {
  if (game.winner) return [];
  const out: ActionV2[] = [];
  if (game.pending) {
    if (game.pending.priority !== team) return out;
    out.push({ type: "pass" });
    for (const p of fastPlaysV2(game, team)) out.push({ type: "play", card: p.card.uid, rank: p.rank, target: p.target });
    return out;
  }
  if (game.turn.team !== team) return out;
  const t = game.turn;
  const tm = game.teams[team];
  switch (t.phase) {
    case "draw":
      for (const c of tm.champions) if (c.alive && deckSizeV2(game, c.uid) > 0) out.push({ type: "draw", champion: c.uid });
      if (tm.hand.length >= balance.hand.max_size) out.push({ type: "skipDraw" });
      break;
    case "act": {
      for (const c of tm.champions) {
        if (!c.alive) continue;
        const active = t.main === c.uid;
        if (!active && t.activated.includes(c.uid)) continue;
        const budget = active ? t.movementLeft : movementBudgetV2(c, t.die);
        if (budget > 0) {
          for (const r of reachableMap(game, c, budget).values()) out.push({ type: "move", to: r.pos, champion: c.uid });
        }
        if (!active) out.push({ type: "stay", champion: c.uid });
      }
      for (const c of tm.champions) {
        if (!c.alive || t.basicUsed.includes(c.uid)) continue;
        const basic = getChampionDefV2(c.defId).basic;
        const target = basicTargetV2(basic);
        for (const tgt of enumerateTargetsV2(game, c, { range: basic.range, target })) out.push({ type: "basic", target: tgt, champion: c.uid });
      }
      for (const card of tm.hand) {
        const def = getCardDefV2(card.cardId);
        const owner = getChampionV2(game, card.owner);
        if (!owner.alive) continue;
        for (const rank of def.ranks) {
          if (!canPayV2(game, team, rank.cost)) continue;
          for (const target of enumerateTargetsV2(game, owner, { range: rankRangeV2(rank), target: def.target })) {
            out.push({ type: "play", card: card.uid, rank: rank.rank, target });
          }
        }
      }
      out.push({ type: "end" });
      break;
    }
    case "discard":
      for (const c of tm.hand) out.push({ type: "discard", card: c.uid });
      break;
  }
  return out;
}
