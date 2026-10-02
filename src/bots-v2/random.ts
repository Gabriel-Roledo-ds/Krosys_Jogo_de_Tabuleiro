// Bot aleatório do motor hexagonal (roster v2) — mesma ideia de src/bots/random.ts
// (MVP): escolhe qualquer ação legal, evitando encerrar o turno cedo demais à toa.
// Serve pra achar bug no motor em simulação de milhares de ações (ver tests/sim-v2.test.ts).

import { legalActionsV2, type ActionV2 } from "../engine-v2/turn";
import type { GameStateV2, TeamId } from "../engine-v2/state";
import { createRng, type Rng } from "../engine/rng";

export function randomBotV2(rng: Rng) {
  return (s: GameStateV2, team: TeamId): ActionV2 => {
    const actions = legalActionsV2(s, team);
    if (actions.length === 0) throw new Error(`Sem ações legais para ${team} (fase ${s.turn.phase})`);
    const nonEnd = actions.filter((a) => a.type !== "end" && a.type !== "pass");
    if (nonEnd.length > 0 && rng.next() < 0.85) return rng.pick(nonEnd);
    return rng.pick(actions);
  };
}

export { createRng };
