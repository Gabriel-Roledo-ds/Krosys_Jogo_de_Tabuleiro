// Fim de rodada: efeitos que contam em rodadas (fogo, cura contínua, estruturas, aura do boss).

import { balance, getChampionDef, monsterTypes } from "./data";
import { distance, samePos } from "./board";
import { dealDamage, worldSource } from "./damage";
import { getChampion, type GameState } from "./state";
import { heal } from "./status";
import { inRange, liveUnits, isUntargetable } from "./world";
import { resolveDeaths } from "./death";

export function tickRound(s: GameState): void {
  // Chão em chamas: dano contínuo (ignora defesa) em quem estiver nele.
  for (const g of s.ground) {
    if (g.kind === "fire") {
      for (const u of liveUnits(s)) {
        if (samePos(u.pos, g.pos) && !isUntargetable(u)) {
          dealDamage(s, { team: g.team, champion: null, kind: "world", label: "Chão em chamas" }, u, g.damage, { dot: true, element: "fire" });
        }
      }
    }
    g.remaining -= 1;
  }
  s.ground = s.ground.filter((g) => g.remaining > 0);

  // Paredes, portais e molas expiram.
  for (const w of s.walls) if (w.remaining !== null) w.remaining -= 1;
  s.walls = s.walls.filter((w) => w.remaining === null || w.remaining > 0);
  for (const p of s.portals) p.remaining -= 1;
  s.portals = s.portals.filter((p) => p.remaining > 0);
  for (const p of s.springs) p.remaining -= 1;
  s.springs = s.springs.filter((p) => p.remaining > 0);

  // Torre de Vigia: dano contínuo em inimigos no alcance.
  for (const st of s.structures) {
    for (const u of liveUnits(s)) {
      if (u.kind === "champion" && u.team !== st.team && !isUntargetable(u) && inRange(s, st.pos, u.pos, st.range)) {
        dealDamage(s, { team: st.team, champion: null, kind: "world", label: "Torre de Vigia" }, u, st.damage, { dot: true });
      }
    }
  }

  // Aura Terremoto do boss.
  if (s.boss.alive && s.boss.aura?.cardId === "terremoto") {
    for (const c of s.teams.A.champions.concat(s.teams.B.champions)) {
      if (c.alive && !c.untargetable && distance(c.pos, s.boss.pos) <= balance.boss.terremoto_radius) {
        dealDamage(s, { team: null, champion: null, kind: "boss", label: "Terremoto" }, c, 1, { dot: true });
      }
    }
  }

  // Status que contam em rodadas: cura contínua age, todos perdem 1 rodada.
  const all = [...s.teams.A.champions, ...s.teams.B.champions];
  for (const c of all) {
    if (!c.alive) continue;
    for (const st of c.statuses) {
      if (st.unit !== "rounds") continue;
      if (st.kind === "hot") heal(c, st.amount ?? 0);
      st.remaining -= 1;
    }
    c.statuses = c.statuses.filter((st) => st.unit !== "rounds" || st.remaining > 0);
  }
  for (const u of [...s.monsters, ...s.minions, s.boss]) {
    for (const st of u.statuses) st.remaining -= 1;
    u.statuses = u.statuses.filter((st) => st.remaining > 0);
  }

  // Efeito contínuo dos monstros: o fraco regenera.
  for (const m of s.monsters) {
    const eff = monsterTypes[m.type].continuous_effect;
    if (m.alive && eff.type === "regen_per_round") m.hp = Math.min(m.maxHp, m.hp + eff.amount);
  }

  resolveDeaths(s);
}

export { getChampion, getChampionDef, worldSource };
