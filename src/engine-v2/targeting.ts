// Validação de alvos de cartas/habilidades no motor hexagonal (roster v2).
// Equivalente a src/engine/targeting.ts, mas em coordenadas axiais. "wall" já
// resolve de verdade (ver world.ts); "dead_ally" já valida de verdade (resurrect,
// ver death.ts).
//
// Boss (item 6 do KANBAN): só o alvo único "enemy" pode escolher o boss
// (uid BOSS_UID_V2 de boss.ts) — random_enemies/área continuam só entre
// campeões por enquanto [PADRÃO, ver boss.ts/cardPlay.ts pro porquê do escopo
// menor aqui].
//
// Monstros do mapa (item 7 do KANBAN, monsters.ts): mesmo escopo do boss — só
// o alvo único "enemy" pode escolher um monstro vivo (uid "monster-N").

import { hexAdjacent, hexDistance, hexesInRadius, HEX_DIRECTIONS, isHexInLine, sameHex, type Hex } from "../design/hexGrid";
import { inHexBoard } from "../design/hexBoard";
import { allChampionsV2, getChampionV2, type ChampionStateV2, type GameStateV2, type TeamId } from "./state";
import { hasLineOfSightV2, wallAtV2 } from "./world";
import { BOSS_UID_V2, isMinionUidV2 } from "./boss";
import { isMonsterUidV2 } from "./monsters";
import { isTempleUidV2 } from "./temples";

export interface TargetableV2 {
  range: number | "self";
  target: string;
}

export const rangeOfV2 = (def: TargetableV2, bonus = 0): number => (def.range === "self" ? 0 : def.range + bonus);

export interface TargetV2 {
  uid?: string;
  /** Segundo alvo-campeão — só usado por "two_enemies" (Elo Natural da Sylvane, ver effects.ts applyLink). */
  uid2?: string;
  pos?: Hex;
  pos2?: Hex;
  dir?: Hex;
}

const inRange = (s: GameStateV2, from: Hex, to: Hex, range: number): boolean =>
  inHexBoard(to, s.board) && hexDistance(from, to) <= range && hasLineOfSightV2(s, from, to);

const isDirection = (d?: Hex): boolean => !!d && HEX_DIRECTIONS.some((v) => v.q === d.q && v.r === d.r);

function findChampion(s: GameStateV2, uid?: string): ChampionStateV2 | null {
  if (!uid) return null;
  try {
    return getChampionV2(s, uid);
  } catch {
    return null;
  }
}

/** Devolve null se o alvo é válido, ou o motivo (em português) se não for. */
export function validateTargetV2(s: GameStateV2, owner: ChampionStateV2, def: TargetableV2, t: TargetV2, rangeBonus = 0): string | null {
  const range = rangeOfV2(def, rangeBonus);

  const enemyAt = (uid?: string): string | null => {
    if (uid === BOSS_UID_V2) {
      if (!s.boss.alive) return "boss não está em campo";
      if (!inRange(s, owner.pos, s.boss.pos, range)) return "fora de alcance";
      return null;
    }
    if (isMonsterUidV2(uid)) {
      const m = s.monsters.find((x) => x.uid === uid);
      if (!m || !m.alive) return "monstro não está em campo";
      if (!inRange(s, owner.pos, m.pos, range)) return "fora de alcance";
      return null;
    }
    if (isMinionUidV2(uid)) {
      const m = s.minions.find((x) => x.uid === uid);
      if (!m || !m.alive) return "lacaio não está em campo";
      if (!inRange(s, owner.pos, m.pos, range)) return "fora de alcance";
      return null;
    }
    if (isTempleUidV2(uid)) {
      const t = s.temples.find((x) => x.uid === uid);
      if (!t || !t.alive) return "guardião de templo não está em campo";
      if (!inRange(s, owner.pos, t.pos, range)) return "fora de alcance";
      return null;
    }
    const u = findChampion(s, uid);
    if (!u) return "alvo inexistente";
    if (!u.alive) return "alvo não está em campo";
    if (u.team === owner.team) return "alvo não é inimigo";
    if (!inRange(s, owner.pos, u.pos, range)) return "fora de alcance";
    return null;
  };

  const championAt = (uid: string | undefined, allyOnly: boolean, allowSelf: boolean): string | null => {
    const u = findChampion(s, uid);
    if (!u) return "alvo inválido";
    if (!u.alive) return "alvo não está em campo";
    if (allyOnly && u.team !== owner.team) return "alvo não é aliado";
    if (!allowSelf && u.uid === owner.uid) return "não pode ser o próprio campeão";
    if (!inRange(s, owner.pos, u.pos, range)) return "fora de alcance";
    return null;
  };

  switch (def.target) {
    case "self":
      return null;
    case "random_enemies": {
      // Boss, monstros/lacaios do mapa e guardiões de templo também entram no
      // sorteio (ver randomDamageCandidatesV2 em cardPlay.ts) — a carta é
      // jogável se qualquer um desses tipos estiver ao alcance, não só campeão.
      const champOk = allChampionsV2(s).some((c) => c.alive && c.team !== owner.team && inRange(s, owner.pos, c.pos, range));
      const bossOk = s.boss.alive && inRange(s, owner.pos, s.boss.pos, range);
      const monsterOk = s.monsters.some((m) => m.alive && inRange(s, owner.pos, m.pos, range));
      const minionOk = s.minions.some((m) => m.alive && inRange(s, owner.pos, m.pos, range));
      const templeOk = s.temples.some((t) => t.alive && inRange(s, owner.pos, t.pos, range));
      return champOk || bossOk || monsterOk || minionOk || templeOk ? null : "nenhum inimigo ao alcance";
    }
    case "enemy":
      return enemyAt(t.uid);
    case "two_enemies": {
      // Elo Natural da Sylvane (regras-e-decisoes.md §19/claude/formato-dados.md
      // "link" + share_control_percent) liga DOIS inimigos entre si, não o
      // próprio campeão a um inimigo — igual ao "Elo" do MVP original
      // (src/engine/targeting.ts, mesmo nome de target). Só campeão de verdade
      // entra aqui (não boss/monstro/lacaio): o vínculo mora em
      // ChampionStateV2.statuses, que só campeão tem.
      const enemyChampionAt = (uid?: string): string | null => {
        const u = findChampion(s, uid);
        if (!u) return "alvo inválido";
        if (!u.alive) return "alvo não está em campo";
        if (u.team === owner.team) return "alvo não é inimigo";
        if (!inRange(s, owner.pos, u.pos, range)) return "fora de alcance";
        return null;
      };
      return enemyChampionAt(t.uid) ?? enemyChampionAt(t.uid2) ?? (t.uid === t.uid2 ? "os dois alvos precisam ser diferentes" : null);
    }
    case "ally":
      return championAt(t.uid, true, true);
    case "champion":
      return championAt(t.uid, false, true);
    case "champion_in_line": {
      const err = championAt(t.uid, false, false);
      if (err) return err;
      const u = findChampion(s, t.uid)!;
      return isHexInLine(owner.pos, u.pos) ? null : "fora de linha";
    }
    case "direction":
      return isDirection(t.dir) ? null : "direção inválida";
    case "cell":
      if (!t.pos) return "alvo inválido";
      return inRange(s, owner.pos, t.pos, range) ? null : "fora de alcance";
    case "two_cells": {
      if (!t.pos || !t.pos2) return "alvo inválido";
      if (!inRange(s, owner.pos, t.pos, range)) return "primeira casa fora de alcance";
      if (!inRange(s, owner.pos, t.pos2, range)) return "segunda casa fora de alcance";
      if (sameHex(t.pos, t.pos2)) return "as duas casas precisam ser diferentes";
      return null;
    }
    case "line":
      if (!t.pos) return "alvo inválido";
      if (!inRange(s, owner.pos, t.pos, range)) return "fora de alcance";
      return isHexInLine(owner.pos, t.pos) ? null : "fora de linha";
    case "wall": {
      if (!t.pos) return "alvo inválido";
      if (!inRange(s, owner.pos, t.pos, range)) return "fora de alcance";
      return wallAtV2(s, t.pos) ? null : "não há parede nessa casa";
    }
    case "dead_ally": {
      // Sem checagem de alcance: um campeão morto não tem posição relevante
      // em campo (ver death.ts) — "alcance" aqui é só até onde o rank chega,
      // mas o que importa é escolher QUAL aliado caído, não onde ele está.
      const u = findChampion(s, t.uid);
      if (!u) return "alvo inválido";
      if (u.team !== owner.team) return "alvo não é aliado";
      if (u.alive) return "alvo não está morto";
      return null;
    }
    default:
      return `tipo de alvo desconhecido: ${def.target}`;
  }
}

/** Lista de inimigos vivos ao alcance — usada por random_enemies/two_enemies. */
export function enemiesInRange(s: GameStateV2, owner: ChampionStateV2, def: TargetableV2, rangeBonus = 0): ChampionStateV2[] {
  const range = rangeOfV2(def, rangeBonus);
  return allChampionsV2(s).filter((c) => c.alive && c.team !== owner.team && inRange(s, owner.pos, c.pos, range));
}

/** `true` se `pos` está ao alcance de `owner` e dentro do tabuleiro. */
export function inRangeOf(s: GameStateV2, owner: ChampionStateV2, pos: Hex, def: TargetableV2, rangeBonus = 0): boolean {
  return inRange(s, owner.pos, pos, rangeOfV2(def, rangeBonus));
}

export interface AreaFilterV2 {
  /** Só campeões vivos (default true). */
  aliveOnly?: boolean;
  /** Restringe a uma equipe (ex. "allies_only" em cartas como Barreira em Área). */
  team?: TeamId;
  /** Exclui um uid específico (ex. o próprio campeão que lançou a carta). */
  excludeUid?: string;
}

/**
 * Campeões dentro de `radius` casas de `center` (centro incluso, raio 0 =
 * só a própria casa). Usado pra resolver "quem é afetado" de cartas de área
 * (`damage`/`apply_status_area` com `radius`, `heal_all_allies`/`shield_all_allies`
 * não passam por aqui — já são "toda a equipe", sem centro) depois que a
 * casa-centro em si já foi validada por `validateTargetV2` (target "cell").
 */
export function championsInRadius(s: GameStateV2, center: Hex, radius: number, filter: AreaFilterV2 = {}): ChampionStateV2[] {
  const cells = new Set(hexesInRadius(center, radius).map((h) => `${h.q},${h.r}`));
  const aliveOnly = filter.aliveOnly ?? true;
  return allChampionsV2(s).filter((c) => {
    if (aliveOnly && !c.alive) return false;
    if (filter.team && c.team !== filter.team) return false;
    if (filter.excludeUid && c.uid === filter.excludeUid) return false;
    return cells.has(`${c.pos.q},${c.pos.r}`);
  });
}

/**
 * Alvos candidatos pra um `target`+alcance dado — usado por turn.ts pra
 * decidir se uma carta/básica tem pelo menos um alvo válido (jogadas rápidas
 * possíveis, ações legais) e, nos testes/bots, pra listar opções. Não cobre
 * `two_cells` (único consumidor hoje é `create_portal_pair`, já implementado
 * em effects.ts — ver applyCreatePortalPair) — devolve lista vazia por
 * enquanto: enumerar pares de casas válidas é mais caro (produto de duas
 * áreas) e nenhum bot ainda precisa escolher esse alvo sozinho [PADRÃO,
 * revisar se os bots v2 forem ensinados a usar Portal do Dorin].
 */
export function enumerateTargetsV2(s: GameStateV2, owner: ChampionStateV2, def: TargetableV2, rangeBonus = 0, cap = 30): TargetV2[] {
  const out: TargetV2[] = [];
  const push = (t: TargetV2) => {
    if (out.length < cap) out.push(t);
  };
  const range = rangeOfV2(def, rangeBonus);

  switch (def.target) {
    case "self":
    case "random_enemies":
      push({});
      break;
    case "enemy":
      for (const c of enemiesInRange(s, owner, def, rangeBonus)) push({ uid: c.uid });
      if (s.boss.alive && inRange(s, owner.pos, s.boss.pos, range)) push({ uid: BOSS_UID_V2 });
      for (const m of s.monsters) {
        if (m.alive && inRange(s, owner.pos, m.pos, range)) push({ uid: m.uid });
      }
      for (const m of s.minions) {
        if (m.alive && inRange(s, owner.pos, m.pos, range)) push({ uid: m.uid });
      }
      for (const t of s.temples) {
        if (t.alive && inRange(s, owner.pos, t.pos, range)) push({ uid: t.uid });
      }
      break;
    case "two_enemies": {
      const enemies = enemiesInRange(s, owner, def, rangeBonus);
      for (const a of enemies) {
        for (const b of enemies) {
          if (a.uid < b.uid) push({ uid: a.uid, uid2: b.uid });
        }
      }
      break;
    }
    case "ally":
    case "champion":
      for (const c of allChampionsV2(s)) {
        if (!c.alive) continue;
        if (def.target === "ally" && c.team !== owner.team) continue;
        if (def.target === "champion" && c.uid === owner.uid) continue;
        if (!inRange(s, owner.pos, c.pos, range)) continue;
        push({ uid: c.uid });
      }
      break;
    case "champion_in_line":
      for (const c of allChampionsV2(s)) {
        if (!c.alive || c.uid === owner.uid) continue;
        if (!inRange(s, owner.pos, c.pos, range)) continue;
        if (!isHexInLine(owner.pos, c.pos)) continue;
        push({ uid: c.uid });
      }
      break;
    case "direction":
      for (const dir of HEX_DIRECTIONS) push({ dir });
      break;
    case "cell":
      for (const h of hexesInRadius(owner.pos, range)) {
        if (inHexBoard(h, s.board)) push({ pos: h });
      }
      break;
    case "line":
      for (const h of hexesInRadius(owner.pos, range)) {
        if (inHexBoard(h, s.board) && isHexInLine(owner.pos, h) && !sameHex(h, owner.pos)) push({ pos: h });
      }
      break;
    case "wall":
      for (const h of hexesInRadius(owner.pos, range)) {
        if (inHexBoard(h, s.board) && wallAtV2(s, h)) push({ pos: h });
      }
      break;
    case "dead_ally":
      for (const c of allChampionsV2(s)) {
        if (c.team === owner.team && !c.alive) push({ uid: c.uid });
      }
      break;
    case "two_cells":
      break;
    default:
      break;
  }
  return out;
}

export { hexAdjacent };
