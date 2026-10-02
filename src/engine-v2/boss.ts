// Boss no motor hexagonal (roster v2) — item 6 da ordem de execução (KANBAN.md).
// Mesmo baralho e números do boss do MVP (data/boss.json via bossDef/getBossCard
// de src/engine/data.ts): não existe design de boss específico pro roster v2
// ainda, então reaproveitar foi a decisão [PADRÃO] (ver regras-e-decisoes.md
// §10/§18) — mesmo pilar de jogo (3 campeões por equipe, boss no centro) e a
// mesma conta de dano se aplica (x1,5 dos campeões, balance.json).
//
// Escopo desta etapa:
// - Ativação por alcance (em casas hexagonais), compra de carta, alvo por tipo
//   (closest/last_attacker/aura/area), e os efeitos usados pelas 11 cartas de
//   boss.json: damage (+also_adjacent_to_target), push, apply_status,
//   heal_boss, discard_random_card_from_hand. `summon_minion` ainda não existe
//   no motor v2 (não há lacaios) — lança erro claro, como qualquer efeito não
//   implementado no resto do motor v2.
// - Ativação resolve IMEDIATAMENTE (sem passar pela pilha de respostas rápidas
//   de turn.ts) — diferente do MVP, que empilha e deixa o jogador responder
//   com carta rápida antes do boss agir. Ampliar isso é trabalho de integração
//   com turn.ts/StackItemV2, fora do escopo desta etapa [PADRÃO, documentar
//   pendência].
// - Champions causam dano no boss por uma função dedicada (`attackBossV2`),
//   não pelo pipeline genérico de cartas/efeitos (`applyDamage` em effects.ts,
//   que só conhece ChampionStateV2) — generalizar aquele pipeline pra aceitar
//   o boss como alvo é um refactor maior, fora do escopo desta etapa. Hoje só
//   cartas/básicas de alvo único "enemy" apontadas pro boss (uid "boss") usam
//   essa função — ver cardPlay.ts/targeting.ts.

import { balance, getBossCard, type BossCardDef } from "../engine/data";
import { hexAdjacent, hexDistance } from "../design/hexGrid";
import { rngOf } from "../engine/rng";
import { allChampionsV2, logV2, type ChampionStateV2, type GameStateV2, type TeamId } from "./state";
import { addStatus } from "./status";
import { pushChampion } from "./movement";
import { discardCardV2 } from "./deck";

/** uid reservado pro boss nos targets de carta/básica (ver cardPlay.ts/targeting.ts). */
export const BOSS_UID_V2 = "boss";

const roundMultiplied = (x: number): number => Math.floor(x + 0.5 + 1e-9);

/** Campeões vivos, atingíveis e dentro do alcance do boss, de uma equipe. */
export function championsInBossRangeV2(s: GameStateV2, team: TeamId): ChampionStateV2[] {
  return s.teams[team].champions.filter((c) => c.alive && !c.untargetable && hexDistance(c.pos, s.boss.pos) <= s.boss.range);
}

export function bossShouldActivateV2(s: GameStateV2, team: TeamId): boolean {
  return s.boss.alive && championsInBossRangeV2(s, team).length > 0;
}

function closestToBoss(s: GameStateV2, list: ChampionStateV2[]): ChampionStateV2 | null {
  return [...list].sort((a, b) => hexDistance(a.pos, s.boss.pos) - hexDistance(b.pos, s.boss.pos) || a.uid.localeCompare(b.uid))[0] ?? null;
}

/** Compra a carta do topo do baralho do boss (reembaralha o descarte se o baralho acabou). */
function drawBossCardIdV2(s: GameStateV2): string {
  if (s.boss.deck.length === 0) {
    s.boss.deck = rngOf(s).shuffle(s.boss.discard);
    s.boss.discard = [];
  }
  return s.boss.deck.shift()!;
}

function fury(s: GameStateV2): number {
  return s.boss.aura?.cardId === "furia" && (s.boss.aura.cardsLeft ?? 0) > 0 ? 1 : 0;
}

/**
 * Ativa o boss para o jogador da vez (se houver campeão da equipe ao alcance):
 * compra a carta, resolve o alvo e aplica os efeitos na hora. Devolve a carta
 * usada (pra log/depuração), ou null se o boss não ativou.
 */
export function activateBossV2(s: GameStateV2, team: TeamId): BossCardDef | null {
  if (!bossShouldActivateV2(s, team)) return null;

  s.boss.damageReduction = 0; // Carapaça dura até a próxima ativação
  const cardId = drawBossCardIdV2(s);
  const card = getBossCard(cardId);
  s.boss.discard.push(card.id);

  if (card.target === "aura") {
    // No máximo 1 aura ativa: a nova substitui a anterior. O boss só ativa, não ataca.
    s.boss.aura = { cardId: card.id, cardsLeft: card.effects.find((e) => e.next_cards)?.next_cards };
    const red = card.effects.find((e) => e.type === "boss_damage_reduction");
    if (red) s.boss.damageReduction = red.amount ?? 0;
    logV2(s, `Boss ativa ${card.name} (aura)`);
    return card;
  }

  const bonus = fury(s);
  let target: ChampionStateV2 | null = null;
  if (card.target === "closest") {
    target = closestToBoss(s, championsInBossRangeV2(s, team));
  } else if (card.target === "last_attacker") {
    const last = s.boss.lastAttacker ? allChampionsV2(s).find((c) => c.uid === s.boss.lastAttacker) : null;
    const valid = last && last.alive && !last.untargetable && hexDistance(last.pos, s.boss.pos) <= s.boss.range;
    target = (valid ? last : closestToBoss(s, championsInBossRangeV2(s, team))) ?? null;
  }

  logV2(s, `Boss ativa ${card.name}${target ? ` em ${target.defId} (${target.team})` : ""}: ${card.text ?? ""}`.trim());

  if (card.target === "area") {
    for (const u of allChampionsV2(s)) {
      if (u.alive && !u.untargetable && hexDistance(u.pos, s.boss.pos) <= (card.radius ?? 3)) applyBossEffectsV2(s, card, u, bonus);
    }
  } else if (target) {
    applyBossEffectsV2(s, card, target, bonus);
  }

  if (bonus > 0 && s.boss.aura?.cardsLeft !== undefined) {
    s.boss.aura.cardsLeft -= 1;
    if (s.boss.aura.cardsLeft <= 0) s.boss.aura = null;
  }
  return card;
}

function applyBossEffectsV2(s: GameStateV2, card: BossCardDef, target: ChampionStateV2, bonus: number): void {
  for (const e of card.effects) {
    switch (e.type) {
      case "damage": {
        dealBossDamageV2(s, target, e.amount ?? 0, bonus);
        if (e.also_adjacent_to_target) {
          for (const u of allChampionsV2(s)) {
            if (u.alive && u.uid !== target.uid && !u.untargetable && hexAdjacent(u.pos, target.pos)) {
              dealBossDamageV2(s, u, e.amount ?? 0, bonus);
            }
          }
        }
        break;
      }
      case "push":
        pushChampion(s, target, s.boss.pos, e.distance ?? 0);
        break;
      case "apply_status":
        addStatus(target, s.nextId++, e.status!, e.duration!.unit, e.duration!.value, { amount: e.amount, negative: true });
        logV2(s, `${target.defId} (${target.team}) recebe ${e.status}`);
        break;
      case "heal_boss":
        s.boss.hp = Math.min(s.boss.maxHp, s.boss.hp + (e.amount ?? 0));
        break;
      case "discard_random_card_from_hand": {
        const teamState = s.teams[target.team];
        for (let i = 0; i < (e.count ?? 1) && teamState.hand.length > 0; i++) {
          const card = rngOf(s).pick(teamState.hand);
          teamState.hand = teamState.hand.filter((c) => c.uid !== card.uid);
          discardCardV2(s, card);
          logV2(s, `${target.defId} (${target.team}) descarta ${card.cardId}`);
        }
        break;
      }
      default:
        throw new Error(`Efeito de boss não implementado no motor v2: ${e.type}`);
    }
  }
}

/**
 * Dano de um campeão no boss (cartas/básicas de alvo único "enemy" apontadas
 * pro boss — ver cardPlay.ts). Mesma ordem de regras-e-decisoes.md §7: base,
 * bônus, multiplicador (x1,5 dos campeões + x2 de recompensa se a equipe tiver
 * a recompensa), defesa fixa do boss (+ Carapaça), mínimo 1. Sem escudo/reflexo
 * (o boss não tem). Marca o atacante como `lastAttacker` e dá/mantém a
 * recompensa (x2 enquanto a mesma equipe seguir acertando) pra equipe dele.
 */
export function attackBossV2(s: GameStateV2, attacker: ChampionStateV2, base: number, opts: { ignoreDefense?: boolean } = {}): number {
  if (!s.boss.alive || base <= 0) return 0;

  let mult = balance.damage.champion_damage_multiplier ?? 1;
  if (attacker.permanentDamageBonusPercent) mult *= 1 + attacker.permanentDamageBonusPercent / 100;
  if (s.bountyTeam === attacker.team) mult *= balance.boss.bounty_multiplier ?? 1;
  let total = mult !== 1 ? roundMultiplied(base * mult) : base;

  if (!opts.ignoreDefense) total -= s.boss.defense + s.boss.damageReduction;
  total = Math.max(balance.damage.minimum_damage_if_base_at_least_1, total);
  const final = Math.max(0, total);
  if (final <= 0) return 0;

  s.boss.hp -= final;
  s.boss.lastAttacker = attacker.uid;
  if (s.bountyTeam !== attacker.team) {
    s.bountyTeam = attacker.team;
    logV2(s, `Equipe ${attacker.team} deu o último golpe no Boss: dano x${balance.boss.bounty_multiplier ?? 1} até ele cair`);
  }
  logV2(s, `Boss sofre ${final} de dano de ${attacker.defId} (${Math.max(0, s.boss.hp)}/${s.boss.maxHp} PV)`);
  return final;
}

/** Dano do boss num campeão (bônus da Fúria somado antes da defesa dele). */
function dealBossDamageV2(s: GameStateV2, target: ChampionStateV2, base: number, bonus: number): void {
  // Reaproveita a conta simples de dano campeão-contra-campeão (sem atacante,
  // dano "do mundo"): bônus fixo (Fúria), defesa do alvo, mínimo 1. O boss não
  // lê status do próprio alvo igual a champion_damage_multiplier porque esse
  // multiplicador já é só "dano causado por campeões" (balance.damage), não
  // se aplica ao boss atacando.
  let total = base + bonus;
  total -= target.defense;
  total = Math.max(balance.damage.minimum_damage_if_base_at_least_1, total);
  const final = Math.max(0, total);
  if (final <= 0) return;
  target.hp -= final;
  logV2(s, `${target.defId} (${target.team}) sofre ${final} de dano do Boss (${Math.max(0, target.hp)}/${target.maxHp} PV)`);
}
