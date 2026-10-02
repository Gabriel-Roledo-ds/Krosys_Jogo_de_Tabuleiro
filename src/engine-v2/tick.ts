// Passagem de tempo do motor hexagonal (roster v2) — equivalente a src/engine/tick.ts
// e ao expireTurnStatuses de src/engine/status.ts, mas só pro que já existe no
// motor novo: status de campeão com duração em "rounds" ou "champion_turns".
//
// Escopo atual: sem chão em chamas/estruturas/paredes/boss ainda (ver
// KANBAN.md) — esse tick entra quando os "efeitos de mundo" (ground_fire,
// venom_zone, venom_terrain, fire_trail, create_structure, delayed_damage)
// forem implementados.

import { allChampionsV2, type ChampionStateV2, type GameStateV2 } from "./state";
import { heal } from "./status";

/**
 * Fim de rodada: cura contínua (`heal_over_time`) age, e todo status em
 * "rounds" perde 1 de duração (removido ao chegar a 0). Pilhas de veneno
 * (`venom_stacks`) não decaem aqui — só são consumidas por detonate_venom_stacks.
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
