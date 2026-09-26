// Efeitos de casa e de chegada: portal, mola, armadilha, muro de chamas, Vigia
// e ataque de monstros. Disparam quando uma unidade termina o movimento numa casa
// (ou é jogada para ela por empurrão, puxão ou mola).

import { distance, samePos } from "./board";
import { dealDamage, worldSource, championSource } from "./damage";
import { getChampion, log, type ChampionState, type GameState } from "./state";
import { forcedMove } from "./movement";
import { monsterTypes } from "./data";
import { inRange, isFreeCell } from "./world";

export interface LandOpts {
  /** Movimento andando (não forçado): monstros atacam. */
  voluntary: boolean;
  /** Já passou por portal ou mola nesta chegada. */
  chained?: boolean;
}

export function onLand(s: GameState, c: ChampionState, opts: LandOpts): void {
  if (!c.alive) return;

  if (!opts.chained) {
    const portal = s.portals.find((p) => samePos(p.a, c.pos) || samePos(p.b, c.pos));
    if (portal) {
      const dest = samePos(portal.a, c.pos) ? portal.b : portal.a;
      if (isFreeCell(s, dest)) {
        c.pos = { ...dest };
        log(s, `${c.uid} atravessa um portal`);
      }
      return onLand(s, c, { ...opts, chained: true });
    }
    const spring = s.springs.find((sp) => samePos(sp.pos, c.pos));
    if (spring) {
      forcedMove(s, c, spring.dir, spring.distance);
      log(s, `${c.uid} é lançado por uma mola`);
      return onLand(s, c, { ...opts, chained: true });
    }
  }

  const trap = s.traps.find((t) => samePos(t.pos, c.pos));
  if (trap) {
    s.traps = s.traps.filter((t) => t.id !== trap.id);
    log(s, `${c.uid} pisa numa armadilha`);
    dealDamage(s, { team: trap.team, champion: null, kind: "world" }, c, trap.damage);
  }

  for (const g of s.ground) {
    if (g.kind === "fire_wall" && samePos(g.pos, c.pos)) {
      dealDamage(s, { team: g.team, champion: null, kind: "world" }, c, g.damage, { element: "fire" });
    }
  }

  // Vigia: o próximo inimigo que entra no alcance leva o dano e a carta se gasta.
  for (const w of [...s.watches]) {
    if (w.team === c.team) continue;
    const owner = getChampion(s, w.owner);
    if (!owner.alive) continue;
    if (distance(owner.pos, c.pos) <= w.range && inRange(s, owner.pos, c.pos, w.range)) {
      s.watches = s.watches.filter((x) => x.id !== w.id);
      log(s, `Vigia de ${w.owner} atinge ${c.uid}`);
      dealDamage(s, championSource(owner), c, w.damage, { direct: true });
    }
  }

  if (opts.voluntary) {
    for (const m of s.monsters) {
      if (m.alive && distance(m.pos, c.pos) <= monsterTypes[m.type].range) {
        log(s, `${m.uid} ataca ${c.uid}`);
        dealDamage(s, { team: null, champion: null, kind: "monster" }, c, monsterTypes[m.type].attack);
      }
    }
    for (const m of s.minions) {
      if (m.alive && distance(m.pos, c.pos) <= 1) {
        dealDamage(s, { team: null, champion: null, kind: "monster" }, c, m.damage);
      }
    }
  }
}

export { worldSource };
