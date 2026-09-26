// Fluxo do turno e ações do jogador. Toda mudança no jogo passa por applyAction.
//
// Fases: boss -> draw -> act -> (discard) -> fim.
// Na fase de ação, o time rola 1 dado; cada campeão pode se mover uma vez (até o valor do dado)
// e só 1 habilidade básica é usada por turno, por qualquer campeão.
// Cartas e básicas vão para a pilha; o adversário pode responder com cartas rápidas
// (a última carta jogada resolve primeiro). Mortes só são resolvidas no fim da pilha.

import { balance, getCardDef, getChampionDef, type Effect } from "./data";
import { posKey, type Pos } from "./board";
import { beginBossActivation, bossShouldActivate, resolveBossItem } from "./boss";
import { resolveDeaths, returnDeadChampions } from "./death";
import { resolveItem } from "./effects";
import { label } from "./damage";
import { onLand } from "./hazards";
import { addMana, canPay, gainTurnMana, spendMana } from "./mana";
import { moveOptionsFor, movePath, movementBudget, reachableMap, rollMovementDie } from "./movement";
import { rngOf } from "./rng";
import {
  getChampion,
  log,
  newTurn,
  otherTeam,
  type CardInstance,
  type ChampionState,
  type GameState,
  type StackItem,
  type TeamId,
  type Target,
} from "./state";
import { expireTurnStatuses } from "./status";
import { tickRound } from "./tick";
import { enumerateTargets, validateTarget } from "./targeting";

export type Action =
  | { type: "draw"; champion: string }
  | { type: "skipDraw" }
  | { type: "move"; to: Pos; champion?: string }
  | { type: "stay"; champion: string }
  | { type: "play"; card: string; target: Target }
  | { type: "basic"; target: Target; champion?: string }
  | { type: "pass" }
  | { type: "discard"; card: string }
  | { type: "end" };

export class IllegalAction extends Error {}

function fail(msg: string): never {
  throw new IllegalAction(msg);
}

/** Comeca a partida: primeiro turno da equipe A. */
export function startGame(s: GameState): void {
  beginTurn(s);
}

// ---------- utilitários de carta ----------

interface CardDefLike {
  range: number | "self";
  target: string;
  effects: Effect[];
  cost: number;
  fast: boolean;
}

/** Definição de uma carta da mão. */
function cardInfo(card: CardInstance): CardDefLike {
  const d = getCardDef(card.cardId);
  return { range: d.range, target: d.target, effects: d.effects, cost: d.cost, fast: d.fast };
}

function basicInfo(c: ChampionState): CardDefLike {
  const b = getChampionDef(c.defId).basic;
  return { range: b.range, target: b.target, effects: b.effects, cost: 0, fast: false };
}

/** Ressurgir só pode ser usado uma vez por partida, por equipe. */
export const resurrectBlocked = (s: GameState, team: TeamId, effects: Effect[]): boolean =>
  effects.some((e) => e.type === "resurrect") && s.teams[team].resurrectUsed;

export const handLimitCount = (s: GameState, team: TeamId): number => s.teams[team].hand.filter((c) => !c.monster).length;

/** Campeão silenciado ou atordoado (efeito que já vale, não o aplicado neste turno) não usa cartas. */
export function cannotCast(c: ChampionState): boolean {
  return c.statuses.some((x) => (x.kind === "silenced" || x.kind === "stunned") && !x.fresh);
}
const cannotBasic = (c: ChampionState): boolean => c.statuses.some((x) => x.kind === "stunned" && !x.fresh);

// ---------- início do turno ----------

function beginTurn(s: GameState): void {
  const team = s.turn.team;
  returnDeadChampions(s, team);
  s.turn = newTurn(team, "boss");
  log(s, `Turno da equipe ${team} (rodada ${s.round})`);

  if (bossShouldActivate(s, team)) {
    const item = beginBossActivation(s, team);
    s.pending = { stack: [item], priority: team, chain: 0 };
    settlePriority(s, team);
  } else {
    enterDrawPhase(s);
  }
}

function enterDrawPhase(s: GameState): void {
  const team = s.turn.team;
  const t = s.teams[team];
  const anyCards = t.champions.some((c) => c.alive && deckSize(s, c) > 0);
  if (!anyCards) {
    gainTurnMana(s, team);
    startAct(s);
    return;
  }
  s.turn.phase = "draw";
}

/** Começa a fase de ação: um dado para o time inteiro e as posições de largada do turno. */
function startAct(s: GameState): void {
  const t = s.turn;
  const team = s.teams[t.team];
  t.phase = "act";
  t.die = rollMovementDie(s);
  t.startPositions = Object.fromEntries(team.champions.filter((x) => x.alive).map((x) => [x.uid, { ...x.pos }]));
  log(s, `Dado do turno: ${t.die}`);
}

const deckSize = (s: GameState, c: ChampionState): number => {
  const d = s.teams[c.team].decks[c.uid];
  return d.draw.length + d.discard.length;
};

/** Compra `n` cartas do baralho do campeão, reembaralhando o descarte se preciso. */
function drawFrom(s: GameState, c: ChampionState, n: number): number {
  const t = s.teams[c.team];
  const deck = t.decks[c.uid];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (deck.draw.length === 0 && deck.discard.length > 0) {
      deck.draw = rngOf(s).shuffle(deck.discard);
      deck.discard = [];
    }
    const card = deck.draw.shift();
    if (!card) break;
    t.hand.push(card);
    drawn++;
  }
  return drawn;
}

// ---------- pilha de respostas rápidas ----------

/** Alguém dessa equipe pode responder agora com uma carta rápida? */
export function canRespond(s: GameState, team: TeamId): boolean {
  return fastPlays(s, team).length > 0;
}

/** Jogadas rápidas possíveis para a equipe (usado também pelos bots). */
export function fastPlays(s: GameState, team: TeamId): { card: CardInstance; target: Target }[] {
  const out: { card: CardInstance; target: Target }[] = [];
  for (const card of s.teams[team].hand) {
    const info = cardInfo(card);
    if (!info.fast || !canPay(s, team, info.cost) || resurrectBlocked(s, team, info.effects)) continue;
    const owner = getChampion(s, card.owner);
    if (!owner.alive || cannotCast(owner)) continue;
    const buff = s.teams[team].nextCardBuff;
    for (const target of enumerateTargets(s, owner, info, buff?.range ?? 0, 6)) out.push({ card, target });
  }
  return out;
}

/** Decide quem responde depois de uma carta entrar na pilha; sem resposta possível, resolve tudo. */
function settlePriority(s: GameState, first: TeamId): void {
  const p = s.pending!;
  const order: TeamId[] = p.chain === 0 && p.stack[0].kind === "boss" ? [first, otherTeam(first)] : [first];
  if (p.chain < balance.fast_cards.max_chained_responses) {
    for (const team of order) {
      if (canRespond(s, team)) {
        p.priority = team;
        return;
      }
    }
  }
  resolveStack(s);
}

function resolveStack(s: GameState): void {
  const p = s.pending;
  if (!p) return;
  let wasBoss = false;
  while (p.stack.length > 0) {
    const item = p.stack.pop()!;
    if (item.kind === "boss") {
      wasBoss = true;
      resolveBossItem(s, item);
    } else {
      const def = item.kind === "basic" ? basicInfo(getChampion(s, item.owner!)) : cardInfo({ cardId: item.cardId } as CardInstance);
      resolveItem(s, item, def);
    }
  }
  s.pending = null;
  resolveDeaths(s);
  if (s.winner) return;
  if (wasBoss && s.turn.phase === "boss") enterDrawPhase(s);
}

function pushItem(s: GameState, item: StackItem): void {
  if (!s.pending) s.pending = { stack: [item], priority: otherTeam(item.team), chain: 0 };
  else {
    s.pending.stack.push(item);
    s.pending.chain += 1;
  }
  settlePriority(s, otherTeam(item.team));
}

// ---------- ações ----------

/** Aplica a ação de uma equipe. Lança IllegalAction se não for permitida. */
export function applyAction(s: GameState, team: TeamId, a: Action): void {
  if (s.winner) fail("A partida já terminou");

  // Janela de resposta: só a equipe com prioridade age (carta rápida ou passar).
  if (s.pending) {
    if (s.pending.priority !== team) fail("Não é a sua vez de responder");
    if (a.type === "pass") return resolveStack(s);
    if (a.type !== "play") fail("Responda com uma carta rápida ou passe");
    return playCard(s, team, a.card, a.target, true);
  }

  if (s.turn.team !== team) fail("Não é o seu turno");
  const t = s.turn;

  switch (a.type) {
    case "draw": {
      if (t.phase !== "draw") fail("Não é a fase de compra");
      const c = getChampion(s, a.champion);
      if (c.team !== team || !c.alive) fail("Campeão inválido");
      const n = s.teams[team].turnsTaken === 0 ? balance.hand.first_turn_draw : balance.hand.draw_per_turn;
      if (drawFrom(s, c, n) === 0) fail("Esse baralho está vazio");
      gainTurnMana(s, team);
      startAct(s);
      return;
    }
    case "skipDraw": {
      if (t.phase !== "draw") fail("Não é a fase de compra");
      if (handLimitCount(s, team) < balance.hand.max_size) fail("Só dá para não comprar com a mão cheia");
      log(s, `Equipe ${team} não compra carta (mão cheia)`);
      gainTurnMana(s, team);
      startAct(s);
      return;
    }
    case "stay": {
      if (t.phase !== "act") fail("Não é a fase de ação");
      const c = getChampion(s, a.champion);
      if (c.team !== team || !c.alive) fail("Campeão inválido");
      if (t.activated.includes(c.uid)) fail("Esse campeão já gastou o movimento");
      activate(s, c);
      log(s, `${label(c)} gasta o movimento parado`);
      return;
    }
    case "move": {
      if (t.phase !== "act") fail("Não é a fase de ação");
      const c = a.champion ? getChampion(s, a.champion) : t.main ? getChampion(s, t.main) : fail("Escolha um campeão para mover");
      if (c.team !== team || !c.alive) fail("Campeão inválido");
      const isActive = t.main === c.uid;
      if (!isActive && t.activated.includes(c.uid)) fail("Esse campeão já se moveu neste turno");
      if (c.statuses.some((x) => x.kind === "immobilized" && !x.fresh)) fail("O campeão está imobilizado");
      const budget = isActive ? t.movementLeft : movementBudget(s, c, t.die);
      const opts = isActive ? moveOptionsFor(s, c) : { ...moveOptionsFor(s, c), phasing: false };
      const path = movePath(s, c, a.to, budget, opts);
      if (!path) fail("Movimento inválido");
      const cost = reachableMap(s, c, budget, opts).get(posKey(a.to))!.cost;
      if (!isActive) activate(s, c);
      t.movementLeft -= cost;
      t.moved += cost;
      t.trail.push(...path);
      c.pos = { ...a.to };
      log(s, `${label(c)} anda até (${a.to.x},${a.to.y})`);
      onLand(s, c, { voluntary: true });
      checkStepBonus(s);
      resolveDeaths(s);
      return;
    }
    case "play":
      return playCard(s, team, a.card, a.target, false);
    case "basic": {
      if (t.phase !== "act") fail("Não é a fase de ação");
      if (t.basicUsed) fail("A habilidade básica já foi usada neste turno");
      const c = a.champion ? getChampion(s, a.champion) : t.main ? getChampion(s, t.main) : fail("Escolha um campeão para a básica");
      if (c.team !== team || !c.alive) fail("Campeão inválido");
      if (cannotBasic(c)) fail("O campeão está atordoado");
      const info = basicInfo(c);
      const err = validateTarget(s, c, info, a.target);
      if (err) fail(err);
      t.basicUsed = true;
      log(s, `${label(c)} usa ${getChampionDef(c.defId).basic.name}`);
      pushItem(s, { kind: "basic", team, owner: c.uid, cardId: `basic:${c.defId}`, target: a.target });
      checkStepBonus(s);
      return;
    }
    case "discard": {
      if (t.phase !== "discard") fail("Não é preciso descartar");
      const card = s.teams[team].hand.find((c) => c.uid === a.card);
      if (!card || card.monster) fail("Carta inválida para descarte");
      s.teams[team].hand = s.teams[team].hand.filter((c) => c.uid !== a.card);
      s.teams[team].decks[card!.owner].discard.push(card!);
      if (handLimitCount(s, team) <= balance.hand.max_size) finishTurn(s);
      return;
    }
    case "end": {
      if (t.phase !== "act") fail("Não é a fase de ação");
      if (handLimitCount(s, team) > balance.hand.max_size) {
        t.phase = "discard";
        return;
      }
      finishTurn(s);
      return;
    }
    case "pass":
      fail("Não há nada para passar");
  }
}

/** O campeão gasta o movimento do turno: vira o campeão ativo e recebe as casas do dado. */
function activate(s: GameState, c: ChampionState): void {
  const t = s.turn;
  t.activated.push(c.uid);
  t.main = c.uid;
  t.trail = [];
  t.moved = 0;
  t.phasing = false;
  t.stepBonus = null;
  t.manaBonusGiven = false;
  t.movementLeft = movementBudget(s, c, t.die);
  log(s, `${label(c)} usa o movimento do turno (até ${t.movementLeft} casas)`);
}

/** Usado por testes e bots: ativa um campeão sem passar pela ação. */
export function activateChampion(s: GameState, c: ChampionState): void {
  activate(s, c);
}

function checkStepBonus(s: GameState): void {
  const t = s.turn;
  if (t.stepBonus && !t.manaBonusGiven && t.moved >= t.stepBonus.distance) {
    addMana(s, t.team, t.stepBonus.amount);
    t.manaBonusGiven = true;
    log(s, "Passo Ágil rende +1 de mana");
  }
}

function playCard(s: GameState, team: TeamId, uid: string, target: Target, isResponse: boolean): void {
  const t = s.turn;
  if (!isResponse && t.phase !== "act") fail("Não é a fase de ação");
  const hand = s.teams[team].hand;
  const card = hand.find((c) => c.uid === uid);
  if (!card) return fail("Carta não está na mão");
  const info = cardInfo(card);
  if (isResponse && !info.fast) fail("Só cartas rápidas respondem");
  const owner = getChampion(s, card.owner);
  if (!owner.alive) fail("O dono da carta não está em campo");
  if (cannotCast(owner)) fail("O campeão não pode usar cartas agora");
  if (!canPay(s, team, info.cost)) fail("Mana insuficiente");
  const buff = s.teams[team].nextCardBuff ?? undefined;
  const err = validateTarget(s, owner, info, target, buff?.range ?? 0);
  if (err) fail(err);
  if (resurrectBlocked(s, team, info.effects)) fail("Ressurgir já foi usado");

  spendMana(s, team, info.cost);
  s.teams[team].hand = hand.filter((c) => c.uid !== uid);
  if (!card.monster) s.teams[team].decks[card.owner].discard.push(card);
  if (buff && !info.effects.some((e) => e.type === "buff_next_card")) s.teams[team].nextCardBuff = null;
  log(s, `${label(owner)} usa ${getCardDef(card.cardId).name}`);
  pushItem(s, { kind: "card", team, owner: owner.uid, cardId: card.cardId, target, buff });
  checkStepBonus(s);
}

function finishTurn(s: GameState): void {
  const t = s.turn;
  const team = s.teams[t.team];
  for (const uid of t.activated) expireTurnStatuses(getChampion(s, uid));
  for (const c of team.champions) c.untargetable = false;
  team.turnsTaken += 1;
  team.nextCardBuff = null;
  const next = otherTeam(t.team);
  if (t.team === "B") {
    tickRound(s);
    if (s.winner) return;
    s.round += 1;
  }
  s.turn = newTurn(next, "boss");
  beginTurn(s);
}

/** Ações legais agora, para bots e para a interface listar o que dá para fazer. */
export function legalActions(s: GameState, team: TeamId): Action[] {
  if (s.winner) return [];
  const out: Action[] = [];
  if (s.pending) {
    if (s.pending.priority !== team) return out;
    out.push({ type: "pass" });
    for (const p of fastPlays(s, team)) out.push({ type: "play", card: p.card.uid, target: p.target });
    return out;
  }
  if (s.turn.team !== team) return out;
  const t = s.turn;
  const tm = s.teams[team];
  switch (t.phase) {
    case "draw":
      for (const c of tm.champions) if (c.alive && deckSize(s, c) > 0) out.push({ type: "draw", champion: c.uid });
      if (handLimitCount(s, team) >= balance.hand.max_size) out.push({ type: "skipDraw" });
      break;
    case "act": {
      for (const c of tm.champions) {
        if (!c.alive) continue;
        const active = t.main === c.uid;
        if (!active && t.activated.includes(c.uid)) continue;
        if (!c.statuses.some((x) => x.kind === "immobilized" && !x.fresh)) {
          const budget = active ? t.movementLeft : movementBudget(s, c, t.die);
          if (budget > 0) {
            const opts = active ? moveOptionsFor(s, c) : { ...moveOptionsFor(s, c), phasing: false };
            for (const r of reachableMap(s, c, budget, opts).values()) out.push({ type: "move", to: r.pos, champion: c.uid });
          }
        }
        if (!active) out.push({ type: "stay", champion: c.uid });
      }
      if (!t.basicUsed) {
        for (const c of tm.champions) {
          if (!c.alive || cannotBasic(c)) continue;
          for (const target of enumerateTargets(s, c, basicInfo(c), 0, 12)) out.push({ type: "basic", target, champion: c.uid });
        }
      }
      const buff = tm.nextCardBuff;
      for (const card of tm.hand) {
        const info = cardInfo(card);
        const owner = getChampion(s, card.owner);
        if (!owner.alive || cannotCast(owner) || !canPay(s, team, info.cost) || resurrectBlocked(s, team, info.effects)) continue;
        for (const target of enumerateTargets(s, owner, info, buff?.range ?? 0, 10)) out.push({ type: "play", card: card.uid, target });
      }
      out.push({ type: "end" });
      break;
    }
    case "discard":
      for (const c of tm.hand) if (!c.monster) out.push({ type: "discard", card: c.uid });
      break;
  }
  return out;
}
