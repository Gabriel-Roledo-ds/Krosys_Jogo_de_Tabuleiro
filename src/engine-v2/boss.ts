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
//   heal_boss, discard_random_card_from_hand, summon_minion (lacaio mínimo —
//   ver MinionStateV2 em state.ts: só hp/dano/posição, sólido, alvo "enemy"
//   único como o boss/monstro do mapa; adicionado numa sessão seguinte, ao
//   ligar os bots v2, porque sem ele qualquer partida travava ao sacar
//   "Prole". Lacaio ataca sozinho quem terminar um movimento voluntário
//   adjacente a ele (attackChampionFromMinionV2 abaixo, chamado direto do case
//   "move" de turn.ts) e pode expirar por rodada se o summon_minion que o
//   criou tiver `duration` (roundsLeft, ver state.ts/tick.ts) — a Prole do
//   boss não define duration, então continua só morrendo por dano.
// - Ativação passa pela pilha de respostas rápidas de turn.ts (02/10/2026,
//   igual ao MVP, src/engine/boss.ts beginBossActivation/resolveBossItem):
//   `beginBossActivationV2` só compra a carta e decide o alvo (closest/
//   last_attacker), devolvendo um StackItemV2 (kind "boss") que turn.ts
//   empilha; `resolveBossItemV2` só aplica o efeito quando a pilha
//   realmente resolver — então um jogador com carta rápida na mão pode
//   responder (escudo, etc.) antes do boss acertar, e o alvo já escolhido
//   é revalidado (vivo/atingível) na hora de resolver, caso tenha mudado
//   no meio da resposta. `turn.ts` exporta `activateBossV2` como o ponto de
//   entrada usado por `beginTurn` (empilha e tenta resolver na hora; só
//   fica esperando se alguém realmente puder responder).
// - Champions causam dano no boss por uma função dedicada (`attackBossV2`),
//   não pelo pipeline genérico de cartas/efeitos (`applyDamage` em effects.ts,
//   que só conhece ChampionStateV2) — generalizar aquele pipeline pra aceitar
//   o boss como alvo é um refactor maior, fora do escopo desta etapa. Hoje só
//   cartas/básicas de alvo único "enemy" apontadas pro boss (uid "boss") usam
//   essa função — ver cardPlay.ts/targeting.ts.

import { balance, getBossCard, type BossCardDef } from "../engine/data";
import { hexAdjacent, hexDistance, hexNeighbors } from "../design/hexGrid";
import { rngOf } from "../engine/rng";
import { allChampionsV2, logV2, type ChampionStateV2, type GameStateV2, type StackItemV2, type TeamId } from "./state";
import { addStatus } from "./status";
import { pushChampion } from "./movement";
import { discardCardV2 } from "./deck";
import { isFreeCellV2 } from "./world";
import { dealDamageV2 } from "./damage";

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
 * Começa a ativação do boss pro jogador da vez (chamado só depois de
 * bossShouldActivateV2 confirmar que há campeão da equipe ao alcance):
 * reseta a Carapaça, compra a carta e já decide o alvo de closest/
 * last_attacker (aura/area são decididos no resolve, igual ao MVP). Devolve
 * o StackItemV2 que turn.ts empilha — o efeito só acontece quando a pilha
 * resolver de verdade (resolveBossItemV2 abaixo), depois de qualquer
 * resposta rápida possível.
 */
export function beginBossActivationV2(s: GameStateV2, team: TeamId): StackItemV2 {
  s.boss.damageReduction = 0; // Carapaça dura até a próxima ativação
  const cardId = drawBossCardIdV2(s);
  const card = getBossCard(cardId);

  let targetUid: string | undefined;
  if (card.target === "closest") {
    targetUid = closestToBoss(s, championsInBossRangeV2(s, team))?.uid;
  } else if (card.target === "last_attacker") {
    const last = s.boss.lastAttacker ? allChampionsV2(s).find((c) => c.uid === s.boss.lastAttacker) : null;
    const valid = last && last.alive && !last.untargetable && hexDistance(last.pos, s.boss.pos) <= s.boss.range;
    targetUid = (valid ? last : closestToBoss(s, championsInBossRangeV2(s, team)))?.uid;
  }

  const who = targetUid ? allChampionsV2(s).find((c) => c.uid === targetUid) : null;
  logV2(s, `Boss ativa ${card.name}${who ? ` em ${who.defId} (${who.team})` : ""}: ${card.text ?? ""}`.trim());
  return { kind: "boss", team, cardId, rank: 0, target: { uid: targetUid } };
}

/**
 * Resolve a ativação do boss já decidida (chamado pela pilha de respostas
 * rápidas quando ninguém mais puder/quiser responder). Revalida o alvo
 * (vivo/atingível) na hora, caso uma resposta tenha mudado o campo entre a
 * declaração e a resolução.
 */
export function resolveBossItemV2(s: GameStateV2, item: StackItemV2): void {
  const card = getBossCard(item.cardId);
  s.boss.discard.push(card.id);

  if (card.target === "aura") {
    // No máximo 1 aura ativa: a nova substitui a anterior. O boss só ativa, não ataca.
    s.boss.aura = { cardId: card.id, cardsLeft: card.effects.find((e) => e.next_cards)?.next_cards };
    const red = card.effects.find((e) => e.type === "boss_damage_reduction");
    if (red) s.boss.damageReduction = red.amount ?? 0;
    logV2(s, `Aura ${card.name} ativa`);
    return;
  }

  const bonus = fury(s);
  const target = item.target.uid ? allChampionsV2(s).find((c) => c.uid === item.target.uid) : null;

  if (card.target === "area") {
    for (const u of allChampionsV2(s)) {
      if (u.alive && !u.untargetable && hexDistance(u.pos, s.boss.pos) <= (card.radius ?? 3)) applyBossEffectsV2(s, card, u, bonus);
    }
  } else if (target && target.alive && !target.untargetable) {
    applyBossEffectsV2(s, card, target, bonus);
  }

  if (bonus > 0 && s.boss.aura?.cardsLeft !== undefined) {
    s.boss.aura.cardsLeft -= 1;
    if (s.boss.aura.cardsLeft <= 0) s.boss.aura = null;
  }
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
      case "summon_minion": {
        const cell = hexNeighbors(target.pos).find((h) => isFreeCellV2(s, h));
        if (cell) {
          const roundsLeft = e.duration?.unit === "rounds" ? e.duration.value : undefined;
          s.minions.push({ uid: `minion-${s.nextId++}`, hp: e.hp ?? 1, maxHp: e.hp ?? 1, damage: e.damage ?? 0, pos: cell, alive: true, roundsLeft });
          logV2(s, "Um lacaio do Boss surge");
        } else {
          logV2(s, "Prole: sem casa livre adjacente, lacaio não surge");
        }
        break;
      }
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

/** uid de um lacaio sempre começa com "minion-" (ver summon_minion acima). */
export const isMinionUidV2 = (uid?: string): boolean => !!uid && uid.startsWith("minion-");

export function findMinionV2(s: GameStateV2, uid: string) {
  const m = s.minions.find((x) => x.uid === uid);
  if (!m) throw new Error(`Lacaio inexistente: ${uid}`);
  return m;
}

/**
 * Dano de um campeão num lacaio (mesmo esquema de attackBossV2/attackMonsterV2:
 * só cartas/básicas de alvo único "enemy" apontadas pro uid do lacaio usam
 * essa função). Sem defesa (lacaio não tem), sem reação (lacaio não reage,
 * diferente dos monstros do mapa — ele só existe enquanto o boss estiver
 * vivo/a carta durar; sem sistema de expiração ainda, outro gap documentado).
 */
export function attackMinionV2(s: GameStateV2, attacker: ChampionStateV2, minionUid: string, base: number): number {
  const minion = findMinionV2(s, minionUid);
  if (!minion.alive || base <= 0) return 0;

  let mult = balance.damage.champion_damage_multiplier ?? 1;
  if (attacker.permanentDamageBonusPercent) mult *= 1 + attacker.permanentDamageBonusPercent / 100;
  const total = mult !== 1 ? roundMultiplied(base * mult) : base;
  const final = Math.max(balance.damage.minimum_damage_if_base_at_least_1, total);
  if (final <= 0) return 0;

  minion.hp -= final;
  logV2(s, `Lacaio sofre ${final} de dano de ${attacker.defId} (${Math.max(0, minion.hp)}/${minion.maxHp} PV)`);
  if (minion.hp <= 0) {
    minion.alive = false;
    logV2(s, "Lacaio do Boss é destruído");
  }
  return final;
}

/**
 * Todo lacaio vivo adjacente a `champion` ataca de volta — chamado só depois
 * de um movimento VOLUNTÁRIO (case "move" de turn.ts), nunca por empurrão
 * (pushChampion), mesma regra do MVP (hazards.ts: `if (opts.voluntary) ...`).
 * Usa dealDamageV2 com skipChampionMultiplier porque é dano de monstro, não
 * de campeão nem "do mundo" — mesma convenção de dealBossDamageV2 acima
 * (balance.damage.champion_damage_multiplier só vale pra "champion"/"world"
 * no MVP, nunca pra "monster", ver src/engine/damage.ts damageMultipliers).
 * Defesa do campeão e escudo ainda valem (passa pelo pipeline de
 * dealDamageV2); a morte é resolvida depois, em resolveDeathsV2, igual a
 * qualquer outro dano no motor v2.
 */
export function minionsAttackAdjacentV2(s: GameStateV2, champion: ChampionStateV2): void {
  if (!champion.alive) return;
  for (const m of s.minions) {
    if (!m.alive || !hexAdjacent(m.pos, champion.pos)) continue;
    const { final } = dealDamageV2(null, champion, m.damage, { skipChampionMultiplier: true });
    if (final > 0) {
      logV2(s, `Lacaio do Boss ataca ${champion.defId} (${champion.team}): ${final} de dano (${Math.max(0, champion.hp)}/${champion.maxHp} PV)`);
    }
  }
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
