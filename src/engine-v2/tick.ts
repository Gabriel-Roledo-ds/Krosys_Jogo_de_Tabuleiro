// Passagem de tempo do motor hexagonal (roster v2) — equivalente a src/engine/tick.ts
// e ao expireTurnStatuses de src/engine/status.ts, mas só pro que já existe no
// motor novo: status de campeão com duração em "rounds"/"champion_turns", as
// áreas de chão (ground_fire, venom_zone — ver applyGroundFire/applyVenomZone
// em effects.ts) e paredes com duração (as permanentes, remaining=null, não
// expiram). venom_terrain (aplica ao entrar, não por rodada), fire_trail
// (rastro do próprio movimento), estruturas/armadilhas/portais/molas e
// create_structure/delayed_damage ainda não entram aqui — precisam de gancho
// no movimento ou numa fila de atraso que não existe no motor novo ainda (ver
// KANBAN.md).

import { hexDistance } from "../design/hexGrid";
import { allChampionsV2, type ChampionStateV2, type GameStateV2 } from "./state";
import { applyVenomStacks, type EffectContextV2 } from "./effects";
import { dealDamageV2 } from "./damage";
import { heal } from "./status";

/**
 * Fim de rodada: cura contínua (`heal_over_time`) age, status em "rounds"
 * perde 1 de duração (removido ao chegar a 0, exceto `venom_stacks` — só
 * consumido por detonate_venom_stacks), e as áreas de chão causam seu dano
 * ou veneno a quem estiver dentro antes de perderem 1 de duração.
 */
export function tickRoundV2(s: GameStateV2): void {
  for (const c of allChampionsV2(s)) {
    if (!c.alive) continue;
    for (const st of c.statuses) {
      if (st.unit !== "rounds" || st.status === "venom_stacks") continue;
      if (st.status === "heal_over_time") heal(c, st.amount ?? 0);
      st.remaining -= 1;
    }
    c.statuses = c.statuses.filter((st) => st.status === "venom_stacks" || st.unit !== "rounds" || st.remaining > 0);
  }

  const ctx: EffectContextV2 = { game: s, attacker: null, nextId: () => s.nextId++ };
  for (const g of s.ground) {
    const inside = allChampionsV2(s).filter((c) => c.alive && hexDistance(c.pos, g.pos) <= g.radius);
    if (g.kind === "fire") {
      for (const c of inside) dealDamageV2(null, c, g.damagePerRound ?? 0, { dot: true });
    } else if (g.kind === "venom") {
      applyVenomStacks(ctx, { type: "apply_venom_stacks", amount: g.stacksPerRound ?? 0 }, inside);
    }
    g.remaining -= 1;
  }
  s.ground = s.ground.filter((g) => g.remaining > 0);

  for (const w of s.walls) if (w.remaining !== null) w.remaining -= 1;
  s.walls = s.walls.filter((w) => w.remaining === null || w.remaining > 0);
}

/**
 * Fim do turno de um campeão principal: expira o controle em "champion_turns"
 * que já valeu neste turno (mesma regra do MVP — aplicado durante o próprio
 * turno só conta a partir do próximo, via a flag `fresh`).
 */
export function expireChampionTurnStatuses(c: ChampionStateV2): void {
  c.statuses = c.statuses.filter((st) => {
    if (st.unit !== "champion_turns") return true;
    if (st.fresh) {
      st.fresh = false;
      return true;
    }
    return false;
  });
}
