// Efeitos de casa no motor hexagonal (roster v2) — igual a src/engine/hazards.ts
// (onLand), mas só pro que já existe no motor novo: armadilha (hidden_trap),
// mola (spring), muro de chamas (fire_wall), terreno venenoso (venom_terrain)
// e marca de área (mark_ground_area) — todos guardados em `game.ground`
// (ver state.ts/effects.ts). Portal (create_portal_pair) e Vigia/zonas de
// monstro-passiva (equivalentes MVP) ainda não existem no motor v2 — ver
// KANBAN.md.
//
// Disparam quando um campeão TERMINA o movimento na casa, seja andando
// (voluntário) ou empurrado/puxado/teletransportado (forçado) — mesma regra
// do MVP. O ataque automático do lacaio do boss ("Prole") continua fora
// daqui, só em movimento voluntário (minionsAttackAdjacentV2, chamado
// direto de turn.ts) — convenção já estabelecida antes deste arquivo existir.

import { hexDirectionTo, hexDistance, sameHex, type Hex } from "../design/hexGrid";
import { dealDamageV2 } from "./damage";
import { forcedMove } from "./movement";
import { addStatus } from "./status";
import { logV2, nextIdV2, type ChampionStateV2, type GameStateV2 } from "./state";

export interface LandOptsV2 {
  /** true = andou por conta própria neste turno; false = foi movido por empurrão/puxão/teleporte de terceiro. */
  voluntary: boolean;
  /**
   * De onde `c` veio nesse deslocamento, se souber. Usado só pela mola
   * (`spring`): lança na mesma direção em que `c` estava se deslocando ao
   * pisar nela [PADRÃO — a carta (`dorin_mola`) tem target "cell", sem
   * direção própria nos dados; "continua pra frente" é mais natural pra uma
   * mola física do que exigir o jogador apontar o lançamento na hora de
   * CRIAR a mola. Sem `from` (ex. campeão já começou o turno na casa da
   * mola, ou foi teleportado por salto/portão sem direção definida), usa um
   * eixo fixo como último recurso.]
   */
  from?: Hex;
  /** Já passou por uma mola nesta chegada (evita um 2º disparo na mesma resolução). */
  chained?: boolean;
}

const FALLBACK_SPRING_DIR: Hex = { q: 1, r: 0 };

/**
 * Resolve os efeitos de casa da posição ATUAL de `c` (depois de qualquer
 * movimento, voluntário ou forçado). Mola lança de novo (`chained: true`,
 * só muda a mola de novo, não os outros efeitos de novo nesse 2º pouso —
 * mesma regra do MVP). Armadilha some depois de disparar (1 vez só).
 */
export function onLandV2(s: GameStateV2, c: ChampionStateV2, opts: LandOptsV2): void {
  if (!c.alive) return;

  if (!opts.chained) {
    const spring = s.ground.find((g) => g.kind === "spring" && sameHex(g.pos, c.pos));
    if (spring) {
      const dir = opts.from && !sameHex(opts.from, c.pos) ? hexDirectionTo(opts.from, c.pos) : FALLBACK_SPRING_DIR;
      forcedMove(s, c, dir, spring.distance ?? 0);
      logV2(s, `${c.defId} (${c.team}) é lançado por uma mola`);
      onLandV2(s, c, { ...opts, chained: true });
      return;
    }
  }

  const trap = s.ground.find((g) => g.kind === "trap" && sameHex(g.pos, c.pos));
  if (trap) {
    s.ground = s.ground.filter((g) => g.id !== trap.id);
    logV2(s, `${c.defId} (${c.team}) pisa numa armadilha`);
    dealDamageV2(null, c, trap.damageOnEnter ?? 0, { dot: true });
    if (trap.slowAmount) addStatus(c, nextIdV2(s), "move_penalty", "rounds", 1, { amount: trap.slowAmount, negative: true });
  }

  const fireWall = s.ground.find((g) => g.kind === "fire_wall" && sameHex(g.pos, c.pos));
  if (fireWall) {
    logV2(s, `${c.defId} (${c.team}) entra no Muro de Chamas`);
    dealDamageV2(null, c, fireWall.damageOnEnter ?? 0, { dot: true });
  }

  const venomTerrain = s.ground.find((g) => g.kind === "venom_terrain" && hexDistance(g.pos, c.pos) <= g.radius);
  if (venomTerrain) {
    logV2(s, `${c.defId} (${c.team}) entra no terreno venenoso`);
    addStatus(c, nextIdV2(s), "venom_stacks", "rounds", 999, { amount: venomTerrain.stacksOnEnter, negative: true });
  }

  const mark = s.ground.find((g) => g.kind === "mark" && hexDistance(g.pos, c.pos) <= g.radius);
  if (mark) {
    const amount = Math.round((mark.storedDamage ?? 0) * (mark.retriggerFraction ?? 0));
    if (amount > 0) {
      logV2(s, `${c.defId} (${c.team}) entra na área marcada`);
      dealDamageV2(null, c, amount, { dot: true });
    }
  }
}
