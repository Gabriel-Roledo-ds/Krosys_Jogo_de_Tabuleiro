// Boss: ativação no início do turno, alvos por carta (closest, last_attacker, aura, area).

import { getBossCard, type BossCardDef } from "./data";
import { addPos, directionTo, distance, isAdjacent } from "./board";
import { dealDamage, label } from "./damage";
import { discardCard } from "./deck";
import { onLand } from "./hazards";
import { forcedMove } from "./movement";
import { rngOf } from "./rng";
import { getChampion, log, otherTeam, type ChampionState, type GameState, type StackItem, type TeamId } from "./state";
import { addStatus, durationText, heal, statusLabel, tryControl } from "./status";
import { isFreeCell, isUntargetable, liveUnits, unitsInRadius } from "./world";
import { addPosSafe } from "./util";

const bossSource = { team: null, champion: null, kind: "boss" } as const;

/** Campeões vivos e atingíveis de uma equipe dentro do alcance do boss. */
export function championsInBossRange(s: GameState, team: TeamId): ChampionState[] {
  return s.teams[team].champions.filter((c) => c.alive && !c.untargetable && distance(c.pos, s.boss.pos) <= s.boss.range);
}

export function bossShouldActivate(s: GameState, team: TeamId): boolean {
  return s.boss.alive && championsInBossRange(s, team).length > 0;
}

function closestTo(s: GameState, list: ChampionState[]): ChampionState | null {
  return [...list].sort((a, b) => distance(a.pos, s.boss.pos) - distance(b.pos, s.boss.pos) || a.uid.localeCompare(b.uid))[0] ?? null;
}

/** Compra a carta do topo (reembaralha o descarte se o baralho acabou). */
function drawBossCardId(s: GameState): string {
  if (s.boss.deck.length === 0) {
    s.boss.deck = rngOf(s).shuffle(s.boss.discard);
    s.boss.discard = [];
  }
  return s.boss.deck.shift()!;
}

/**
 * Começa a ativação do boss para o jogador da vez. Compra a carta, escolhe o alvo
 * e devolve o item que vai para a pilha (o jogador ainda pode responder com cartas rápidas).
 */
export function beginBossActivation(s: GameState, team: TeamId): StackItem {
  s.boss.damageReduction = 0; // Carapaça dura até a próxima ativação
  const cardId = drawBossCardId(s);
  const card = getBossCard(cardId);
  const item: StackItem = { kind: "boss", team, cardId, target: {} };

  if (card.target === "closest") {
    item.target.uid = closestTo(s, championsInBossRange(s, team))?.uid;
  } else if (card.target === "last_attacker") {
    const last = s.boss.lastAttacker ? getChampion(s, s.boss.lastAttacker) : null;
    const valid = last && last.alive && !last.untargetable && distance(last.pos, s.boss.pos) <= s.boss.range;
    item.target.uid = (valid ? last : closestTo(s, championsInBossRange(s, team)))?.uid;
  }
  const who = item.target.uid ? getChampion(s, item.target.uid) : null;
  log(s, `Boss ativa ${card.name}${who ? ` em ${label(who)}` : ""}: ${card.text ?? ""}`.trim());
  return item;
}

function fury(s: GameState): number {
  return s.boss.aura?.cardId === "furia" && (s.boss.aura.cardsLeft ?? 0) > 0 ? 1 : 0;
}

/** Resolve a carta do boss. */
export function resolveBossItem(s: GameState, item: StackItem): void {
  const card = getBossCard(item.cardId);
  s.boss.discard.push(card.id);

  if (card.target === "aura") {
    // No máximo 1 aura ativa: a nova substitui a anterior. O boss só ativa, não ataca.
    s.boss.aura = { cardId: card.id, cardsLeft: card.effects.find((e) => e.next_cards)?.next_cards };
    const red = card.effects.find((e) => e.type === "boss_damage_reduction");
    if (red) s.boss.damageReduction = red.amount;
    log(s, `Aura ${card.name} ativa`);
    return;
  }

  const bonus = fury(s);
  const target = item.target.uid ? getChampion(s, item.target.uid) : null;

  if (card.target === "area") {
    for (const u of unitsInRadius(s, s.boss.pos, card.radius ?? 3)) {
      if (u.kind === "champion") applyBossEffects(s, card, u, bonus);
    }
  } else if (target && target.alive && !target.untargetable) {
    applyBossEffects(s, card, target, bonus);
  }

  if (bonus > 0 && s.boss.aura?.cardsLeft !== undefined) {
    s.boss.aura.cardsLeft -= 1;
    if (s.boss.aura.cardsLeft <= 0) s.boss.aura = null;
  }
}

function applyBossEffects(s: GameState, card: BossCardDef, target: ChampionState, bonus: number): void {
  for (const e of card.effects) {
    switch (e.type) {
      case "damage": {
        dealDamage(s, bossSource, target, e.amount, { bonus, direct: false });
        if (e.also_adjacent_to_target) {
          for (const u of liveUnits(s)) {
            if (u.kind === "champion" && u.uid !== target.uid && isAdjacent(u.pos, target.pos) && !isUntargetable(u)) {
              dealDamage(s, bossSource, u, e.amount, { bonus });
            }
          }
        }
        break;
      }
      case "push": {
        if (!tryControl(s, target)) break;
        const dir = directionTo(s.boss.pos, target.pos);
        if (forcedMove(s, target, dir, e.distance) > 0) onLand(s, target, { voluntary: false });
        break;
      }
      case "apply_status":
        if (tryControl(s, target)) {
          addStatus(s, target, { kind: e.status, unit: e.duration.unit, remaining: e.duration.value, amount: e.amount, negative: true });
          log(s, `${label(target)} recebe ${statusLabel(e.status)} (${durationText(e.duration.unit, e.duration.value)})`);
        }
        break;
      case "heal_boss":
        s.boss.hp = Math.min(s.boss.maxHp, s.boss.hp + e.amount);
        break;
      case "summon_minion": {
        const cell = addPosSafe(target.pos, (p) => isFreeCell(s, p));
        if (cell) {
          s.minions.push({ kind: "minion", uid: `minion-${s.nextId++}`, hp: e.hp, maxHp: e.hp, defense: 0, damage: e.damage, pos: cell, alive: true, statuses: [], lastHitBy: null });
          log(s, "Um lacaio surge");
        }
        break;
      }
      case "discard_random_card_from_hand": {
        const team = s.teams[target.team];
        for (let i = 0; i < e.count && team.hand.length > 0; i++) {
          const card = rngOf(s).pick(team.hand);
          team.hand = team.hand.filter((c) => c.uid !== card.uid);
          discardCard(s, card);
          log(s, `${label(target)} descarta ${card.cardId}`);
        }
        break;
      }
      default:
        throw new Error(`Efeito de boss não implementado: ${e.type}`);
    }
  }
}

export { addPos, heal, otherTeam };
