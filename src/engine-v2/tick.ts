// Passagem de tempo do motor hexagonal (roster v2) — equivalente a src/engine/tick.ts
// e ao expireTurnStatuses de src/engine/status.ts, mas só pro que já existe no
// motor novo: status de campeão com duração em "rounds"/"champion_turns", as
// áreas de chão (ground_fire, venom_zone — ver applyGroundFire/applyVenomZone
// em effects.ts), paredes com duração (as permanentes, remaining=null, não
// expiram), Torre de Vigia (create_structure, dano por rodada em inimigos no
// alcance), dano com atraso (delayed_damage, explode quando roundsLeft chega
// a 0) e lacaios do boss com roundsLeft (summon_minion com duration, ver
// boss.ts). venom_terrain e o bônus do Rastro de Fogo aplicam ao ENTRAR na
// casa, não por rodada — ver hazards.ts.

import { hexDistance } from "../design/hexGrid";
import { allChampionsV2, logV2, type ChampionStateV2, type GameStateV2 } from "./state";
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
      // Bênção de templo (ver temples.ts): `permanent` nunca perde duração nem
      // é removido, mesmo sendo "rounds" — já recebeu o `heal_over_time` acima
      // normalmente, só pula o decremento/remoção abaixo.
      if (st.permanent) continue;
      st.remaining -= 1;
    }
    c.statuses = c.statuses.filter((st) => st.permanent || st.status === "venom_stacks" || st.unit !== "rounds" || st.remaining > 0);
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

  // Torre de Vigia (create_structure, Dorin): dano por rodada a todo inimigo
  // vivo dentro do alcance — igual ao MVP (src/engine/tick.ts).
  for (const st of s.structures) {
    for (const c of allChampionsV2(s)) {
      if (c.alive && c.team !== st.team && hexDistance(st.pos, c.pos) <= st.range) {
        dealDamageV2(null, c, st.damagePerRound, { dot: true });
      }
    }
  }
  for (const st of s.structures) if (st.remaining !== null) st.remaining -= 1;
  s.structures = s.structures.filter((st) => st.remaining === null || st.remaining > 0);

  for (const p of s.portals) if (p.remaining !== null) p.remaining -= 1;
  s.portals = s.portals.filter((p) => p.remaining === null || p.remaining > 0);

  // Explosão Retardada ★ a ★★★ da Ignira (delayed_damage): marca a casa na
  // hora e, `delay_rounds` rodadas depois, acerta quem estiver na área nesse
  // momento (não necessariamente o alvo original, que pode ter se movido).
  for (const d of s.delayedDamages) d.roundsLeft -= 1;
  for (const d of s.delayedDamages.filter((d) => d.roundsLeft <= 0)) {
    logV2(s, "Explosão Retardada detona");
    for (const c of allChampionsV2(s)) {
      if (c.alive && hexDistance(d.pos, c.pos) <= d.radius) dealDamageV2(null, c, d.amount, { dot: true });
    }
  }
  s.delayedDamages = s.delayedDamages.filter((d) => d.roundsLeft > 0);

  // Lacaio com roundsLeft (summon_minion com duration em "rounds", ver boss.ts)
  // expira sozinho ao chegar a 0 — a Prole do boss não define duration, então
  // esses continuam vivos até morrerem por dano (sem entrar neste laço).
  for (const m of s.minions) {
    if (m.alive && m.roundsLeft !== undefined) {
      m.roundsLeft -= 1;
      if (m.roundsLeft <= 0) {
        m.alive = false;
        logV2(s, "Lacaio do Boss desaparece (expirou)");
      }
    }
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
