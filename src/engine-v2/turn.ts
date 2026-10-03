// Fluxo do turno do motor hexagonal (roster v2) — equivalente a
// src/engine/turn.ts, adaptado pro tabuleiro hexagonal e pra carta por rank
// (cardPlay.ts). Fecha o item 4 da ordem de execução em KANBAN.md: junta
// compra, dado de movimento, básica/cartas (com pilha de respostas rápidas),
// descarte e alternância A/B num turno de verdade.
//
// Simplificações assumidas nesta primeira versão (documentadas, não
// silenciosas — ver KANBAN.md):
// - Boss v2 (item 6) ativa no começo do turno (beginTurn), igual ao MVP, mas
//   resolve na hora — não passa pela pilha de respostas rápidas (um jogador
//   não pode responder à ativação do boss com uma carta rápida ainda, ver
//   boss.ts).
// - Efeitos de "pisar na casa" (onLand/hazards.ts) já ligados no movimento
//   voluntário (caso "move" abaixo) — armadilha, mola, portal, muro de
//   chamas, terreno venenoso, marca de área e o bônus do Rastro de Fogo.
// - Sem "Passo Ágil"/bônus de mana por distância andada (nenhuma carta v2
//   usa isso hoje; se alguma vier a usar, entra junto).
//
// Monstros do mapa (item 7, ver monsters.ts): cartas de recompensa de monstro
// (CardInstanceV2.monster === true) não contam no limite de mão (balance.hand.max_size)
// — ver nonMonsterHandSizeV2, usado em vez de tm.hand.length nas 4 checagens de limite.

import { balance, getBossCard, type BossCardDef } from "../engine/data";
import { basicTargetV2, getCardDefV2, getCardRankV2, getChampionDefV2 } from "./data";
import type { Hex } from "../design/hexGrid";
import { hexKey, hexLine, sameHex } from "../design/hexGrid";
import { removeStatus, statusAmount } from "./status";
import { discardCardV2, deckSizeV2, drawFromV2 } from "./deck";
import { resolveDeathsV2, returnDeadChampionsV2 } from "./death";
import { beginBossActivationV2, bossShouldActivateV2, minionsAttackAdjacentV2, resolveBossItemV2 } from "./boss";
import { IllegalActionV2, rankRangeV2, resolveBasicEffectsV2, resolveCardEffectsV2, resurrectBlockedV2 } from "./cardPlay";
import { applySacrificeV2, canSacrificeV2, sacrificeAllyTargetsV2, sacrificeSkipsDrawV2 } from "./sacrifice";

export { IllegalActionV2 };
import { canPayCardV2, gainTurnManaV2, spendCardManaV2 } from "./mana";
import { movementBudgetV2, reachableMap, rollMovementDie } from "./movement";
import { expireChampionTurnStatuses, tickRoundV2 } from "./tick";
import { onLandV2 } from "./hazards";
import { updateVisionMemoryV2 } from "./vision";
import {
  getChampionV2,
  logV2,
  newTurnV2,
  nextIdV2,
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
  | { type: "sacrifice"; champion: string; target?: string }
  | { type: "pass" }
  | { type: "discard"; card: string }
  | { type: "end" }
  | { type: "toggleFast"; enabled: boolean };

function fail(msg: string): never {
  throw new IllegalActionV2(msg);
}

/**
 * Campeão silenciado ou atordoado (efeito que já vale, não o aplicado neste
 * turno) não usa cartas — mesma convenção do MVP (src/engine/turn.ts). Em
 * Sombras da Vextra (sacrifício de passiva, ver sacrifice.ts) bloqueia carta
 * também, via o status "sacrificed_inactive" (ela abriu mão de agir no todo).
 */
export function cannotCastV2(c: ChampionStateV2): boolean {
  return c.statuses.some((x) => (x.status === "silenced" || x.status === "stunned" || x.status === "sacrificed_inactive") && !x.fresh);
}
export const cannotBasicV2 = (c: ChampionStateV2): boolean => c.statuses.some((x) => x.status === "stunned" && !x.fresh);

/**
 * Rastro de Fogo ★ a ★★★ da Ignira (fire_trail, ver effects.ts
 * applyFireTrail): se `c` tiver o status "fire_trail_active" (carta rápida
 * jogada antes de andar), deixa fogo em cada casa do caminho ANDADO agora
 * (voluntário — forçado por empurrão/puxão/mola não deixa rastro, só o
 * próprio passo) e consome o status (1 uso só).
 */
function layFireTrailV2(game: GameStateV2, c: ChampionStateV2, from: Hex): void {
  const trail = c.statuses.find((x) => x.status === "fire_trail_active");
  if (!trail) return;
  removeStatus(c, "fire_trail_active");
  if (sameHex(from, c.pos)) return; // não andou de verdade (ex. custo 0)
  for (const cell of hexLine(from, c.pos)) {
    game.ground.push({
      id: nextIdV2(game),
      kind: "fire",
      pos: { ...cell },
      radius: 0,
      team: c.team,
      remaining: trail.trailDurationRounds ?? 1,
      damagePerRound: trail.amount,
      instantBonusOnEnter: trail.trailInstantBonus,
    });
  }
}

/** Tamanho da mão pro limite (balance.hand.max_size): cartas de recompensa de monstro não contam (claude/monstros-mapa.md). */
function nonMonsterHandSizeV2(hand: CardInstanceV2[]): number {
  return hand.filter((c) => !c.monster).length;
}

/** Começa a partida: primeiro turno da equipe A. */
export function startGameV2(game: GameStateV2): void {
  updateVisionMemoryV2(game); // já nasce com a área de largada de cada equipe explorada (vision.ts)
  beginTurn(game);
}

function beginTurn(game: GameStateV2): void {
  const team = game.turn.team;
  returnDeadChampionsV2(game, team);
  game.turn.phase = "boss";
  logV2(game, `Turno da equipe ${team} (rodada ${game.round})`);
  const activated = bossShouldActivateV2(game, team);
  activateBossV2(game, team);
  if (game.winner) return;
  // Se o boss não ativou, avança direto. Se ativou, activateBossV2 já
  // resolveu na hora (chamando enterDrawPhase lá dentro) quando ninguém podia
  // responder, ou deixou game.pending esperando uma resposta — nos dois casos
  // não há nada mais a fazer aqui.
  if (!activated) enterDrawPhase(game);
}

/**
 * Ativa o boss pra equipe da vez (se houver campeão dela ao alcance): compra
 * a carta, decide o alvo e empilha (StackItemV2 kind "boss") na pilha de
 * respostas rápidas — igual a uma carta/básica, mas com prioridade pra
 * QUALQUER equipe responder primeiro (não só o adversário de quem "jogou"),
 * já que a ativação não tem dono (ver settlePriorityV2). Resolve na hora
 * (chamando resolveStackV2, que aplica o efeito de verdade) quando nenhuma
 * equipe tiver carta rápida pra reagir — o caso comum. Devolve a carta usada
 * (pra log/depuração), ou null se o boss não ativou.
 */
export function activateBossV2(game: GameStateV2, team: TeamId): BossCardDef | null {
  if (!bossShouldActivateV2(game, team)) return null;
  const item = beginBossActivationV2(game, team);
  game.pending = { stack: [item], priority: team, chain: 0 };
  settlePriorityV2(game, team);
  return getBossCard(item.cardId);
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
    if (!owner.alive || cannotCastV2(owner)) continue;
    for (const rank of def.ranks) {
      if (out.length >= cap) break;
      if (!canPayCardV2(game, team, owner, rank.cost)) continue;
      for (const target of enumerateTargetsV2(game, owner, { range: rankRangeV2(rank), target: def.target })) {
        if (out.length >= cap) break;
        out.push({ card, rank: rank.rank, target });
      }
    }
  }
  return out;
}

/**
 * Alguém dessa equipe pode responder agora com uma carta rápida? Usado só por
 * `settlePriorityV2` pra decidir a quem oferecer a janela — por isso também
 * respeita o botão de ligar/desligar (`fastWindowEnabled`, §6/§16): desligado,
 * a equipe nunca recebe a prioridade, mesmo tendo uma carta rápida jogável
 * (ela continua podendo jogá-la depois, se vier a ter prioridade por outro
 * motivo — isso só afeta a CONCESSÃO da janela, não `fastPlaysV2` em si, que
 * `legalActionsV2`/bots seguem usando direto quando já é a vez deles).
 */
export const canRespondV2 = (game: GameStateV2, team: TeamId): boolean =>
  game.teams[team].fastWindowEnabled !== false && fastPlaysV2(game, team, 1).length > 0;

/**
 * Decide quem responde a seguir. Ativação do boss é especial: como não tem
 * "dono" (não é a carta de ninguém), as DUAS equipes têm a chance de
 * responder antes de resolver, começando por `first` (igual ao MVP,
 * src/engine/turn.ts) — carta/básica normal só dá a chance ao adversário de
 * quem jogou (chamado com first = otherTeam(item.team) em pushItemV2).
 */
function settlePriorityV2(game: GameStateV2, first: TeamId): void {
  const p = game.pending!;
  const order: TeamId[] = p.chain === 0 && p.stack[0].kind === "boss" ? [first, otherTeam(first)] : [first];
  if (p.chain < balance.fast_cards.max_chained_responses) {
    for (const team of order) {
      if (canRespondV2(game, team)) {
        p.priority = team;
        return;
      }
    }
  }
  resolveStackV2(game);
}

function resolveStackV2(game: GameStateV2): void {
  const p = game.pending;
  if (!p) return;
  let wasBoss = false;
  while (p.stack.length > 0) {
    const item = p.stack.pop()!;
    if (item.kind === "boss") {
      wasBoss = true;
      resolveBossItemV2(game, item);
      continue;
    }
    const owner = getChampionV2(game, item.owner!);
    if (!owner.alive) {
      logV2(game, `${item.owner} não está em campo: a ação falha`);
      continue;
    }
    // Fúria Desenfreada do Borak (sacrifício de passiva, §22): +3 de dano fixo
    // em toda carta/básica do turno, somado ao bônus de sempre (buff_next_card).
    const sacrificeBonus = statusAmount(owner, "sacrifice_bonus_damage");
    if (item.kind === "card") {
      const def = getCardDefV2(item.cardId);
      const rank = getCardRankV2(def, item.rank);
      resolveCardEffectsV2(game, owner, def, rank, item.target, (item.buff?.bonusDamage ?? 0) + sacrificeBonus);
    } else {
      resolveBasicEffectsV2(game, owner, getChampionDefV2(owner.defId).basic, item.target, sacrificeBonus);
    }
  }
  game.pending = null;
  resolveDeathsV2(game, game.turn.team);
  if (wasBoss && !game.winner && game.turn.phase === "boss") enterDrawPhase(game);
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
  if (cannotCastV2(owner)) fail("O campeão não pode usar cartas agora");
  const rank = getCardRankV2(def, rankNumber);

  // Toxina Concentrada do Thorne (sacrifício de passiva, §22): -2 casas de
  // alcance em toda carta do turno.
  const rangeBonus = -statusAmount(owner, "sacrifice_range_penalty");
  const err = validateTargetV2(game, owner, { range: rankRangeV2(rank), target: def.target }, t, rangeBonus);
  if (err) fail(err);
  if (!canPayCardV2(game, team, owner, rank.cost)) fail("Mana insuficiente");
  if (resurrectBlockedV2(game, team, rank.effects)) fail("Ressurgir já foi usado");

  const buff = game.teams[team].nextCardBuff ?? undefined;
  spendCardManaV2(game, team, owner, rank.cost);
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

  // Botão de ligar/desligar a própria janela de resposta rápida
  // (regras-e-decisoes.md §6/§16): meta-ação de interface, não um lance do
  // turno — pode ser usada a qualquer momento (mesmo fora do próprio turno,
  // mesmo com `game.pending` aberto pra OUTRA equipe), exceto enquanto a
  // janela já está aberta especificamente pra quem está tentando mudar (pra
  // não dar pra "voltar atrás" no meio da própria decisão de responder).
  if (a.type === "toggleFast") {
    if (game.pending && game.pending.priority === team) fail("não pode mudar agora: a janela de resposta já está aberta pra você");
    game.teams[team].fastWindowEnabled = a.enabled;
    logV2(game, `Equipe ${team} ${a.enabled ? "liga" : "desliga"} a própria janela de resposta rápida`);
    return;
  }

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
      if (nonMonsterHandSizeV2(tm.hand) < balance.hand.max_size) fail("Só dá para não comprar com a mão cheia");
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
      const from = { ...c.pos };
      c.pos = { ...a.to };
      logV2(game, `${c.defId} (${c.team}) anda até (${a.to.q},${a.to.r})`);
      layFireTrailV2(game, c, from);
      onLandV2(game, c, { voluntary: true, from });
      minionsAttackAdjacentV2(game, c);
      resolveDeathsV2(game, team);
      updateVisionMemoryV2(game); // novo campo de visão depois do movimento (vision.ts)
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
      if (cannotBasicV2(c)) fail("O campeão está atordoado");
      const basic = getChampionDefV2(c.defId).basic;
      const rangeBonus = -statusAmount(c, "sacrifice_range_penalty");
      const err = validateTargetV2(game, c, { range: basic.range, target: basicTargetV2(basic) }, a.target, rangeBonus);
      if (err) fail(err);
      t.basicUsed.push(c.uid);
      logV2(game, `${c.defId} (${c.team}) usa ${basic.name}`);
      pushItemV2(game, { kind: "basic", team, owner: c.uid, cardId: `basic:${c.defId}`, rank: 0, target: a.target });
      return;
    }
    case "sacrifice": {
      const err = canSacrificeV2(game, team, a.champion, a.target);
      if (err) fail(err);
      const c = getChampionV2(game, a.champion);
      const needsDrawSkip = sacrificeSkipsDrawV2(c.defId);
      applySacrificeV2(game, team, a.champion, a.target);
      if (needsDrawSkip) {
        gainTurnManaV2(game, team);
        startAct(game);
      }
      return;
    }
    case "discard": {
      if (t.phase !== "discard") fail("Não é preciso descartar");
      const card = tm.hand.find((c) => c.uid === a.card);
      if (!card) fail("Carta inválida para descarte");
      tm.hand = tm.hand.filter((c) => c.uid !== a.card);
      discardCardV2(game, card);
      if (nonMonsterHandSizeV2(tm.hand) <= balance.hand.max_size) finishTurn(game);
      return;
    }
    case "end": {
      if (t.phase !== "act") fail("Não é a fase de ação");
      if (nonMonsterHandSizeV2(tm.hand) > balance.hand.max_size) {
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
  for (const c of tm.champions) {
    c.untargetable = false;
    c.sacrificeUsedThisTurn = false;
  }
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
      if (nonMonsterHandSizeV2(tm.hand) >= balance.hand.max_size) out.push({ type: "skipDraw" });
      for (const c of tm.champions) if (!canSacrificeV2(game, team, c.uid)) out.push({ type: "sacrifice", champion: c.uid });
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
        if (!c.alive || t.basicUsed.includes(c.uid) || cannotBasicV2(c)) continue;
        const basic = getChampionDefV2(c.defId).basic;
        const target = basicTargetV2(basic);
        for (const tgt of enumerateTargetsV2(game, c, { range: basic.range, target })) out.push({ type: "basic", target: tgt, champion: c.uid });
      }
      for (const card of tm.hand) {
        const def = getCardDefV2(card.cardId);
        const owner = getChampionV2(game, card.owner);
        if (!owner.alive || cannotCastV2(owner)) continue;
        for (const rank of def.ranks) {
          if (!canPayCardV2(game, team, owner, rank.cost)) continue;
          if (resurrectBlockedV2(game, team, rank.effects)) continue;
          for (const target of enumerateTargetsV2(game, owner, { range: rankRangeV2(rank), target: def.target })) {
            out.push({ type: "play", card: card.uid, rank: rank.rank, target });
          }
        }
      }
      for (const c of tm.champions) {
        if (!c.alive) continue;
        if (getChampionDefV2(c.defId).sacrifice === null) continue;
        if (c.defId === "varek") {
          for (const allyUid of sacrificeAllyTargetsV2(game, c.uid)) {
            if (!canSacrificeV2(game, team, c.uid, allyUid)) out.push({ type: "sacrifice", champion: c.uid, target: allyUid });
          }
        } else if (!canSacrificeV2(game, team, c.uid)) {
          out.push({ type: "sacrifice", champion: c.uid });
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
