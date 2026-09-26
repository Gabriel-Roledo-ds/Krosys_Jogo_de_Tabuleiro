// Bot aleatório: escolhe qualquer ação legal. Serve para achar bugs no motor.

import { legalActions, type Action } from "../engine/turn";
import type { GameState, TeamId } from "../engine/state";
import { createRng, type Rng } from "../engine/rng";

export function randomBot(rng: Rng) {
  return (s: GameState, team: TeamId): Action => {
    const actions = legalActions(s, team);
    if (actions.length === 0) throw new Error(`Sem ações legais para ${team} (fase ${s.turn.phase})`);
    // Evita encerrar cedo demais: "end" só entra quando não há mais nada melhor de vez em quando.
    const nonEnd = actions.filter((a) => a.type !== "end");
    if (nonEnd.length > 0 && rng.next() < 0.85) return rng.pick(nonEnd);
    return rng.pick(actions);
  };
}

export { createRng };
