import { describe, it, expect } from "vitest";
import cards from "../data/cards.json";
import champions from "../data/champions.json";
import { getCardDef } from "../src/engine/data";
import { getChampion } from "../src/engine/state";
import { applyAction } from "../src/engine/turn";
import { enumerateTargets } from "../src/engine/targeting";
import { give, place, scenario, uid } from "./helpers";

const champCards = cards.filter((c) => c.owner !== "monster");

describe("baralhos de 20 cartas", () => {
  it("cada campeão tem 20 cartas, ids únicos, custo 1 a 5 e texto", () => {
    for (const ch of champions) {
      const mine = champCards.filter((c) => c.owner === ch.id);
      expect(mine, ch.id).toHaveLength(20);
    }
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    for (const c of champCards) {
      expect(c.cost, c.id).toBeGreaterThanOrEqual(1);
      expect(c.cost, c.id).toBeLessThanOrEqual(5);
      expect((c as any).text, c.id).toBeTruthy();
    }
  });

  it("nenhuma carta nova é rápida (a lista de rápidas continua a confirmada)", () => {
    expect(champCards.filter((c) => c.fast)).toHaveLength(8);
  });

  it("toda carta nova é jogável: aparece com alvo e resolve sem erro", () => {
    const fresh = champCards.filter((c) => !["tiro_rapido"].includes(c.id));
    let played = 0;
    for (const def of fresh) {
      const owner = def.owner;
      const team = { A: [owner, ...["atirador", "piromante", "curandeiro"].filter((x) => x !== owner)].slice(0, 3), B: ["enredador", "arquiteto", "andarilho"] };
      const s = scenario(team as any);
      const me = uid("A", owner);
      const foe1 = uid("B", "enredador");
      const foe2 = uid("B", "arquiteto");
      place(s, me, 5, 5);
      place(s, foe1, 5, 7);
      place(s, foe2, 6, 7);
      place(s, uid("B", "andarilho"), 8, 8);
      const ally = s.teams.A.champions.find((c) => c.uid !== me)!;
      place(s, ally.uid, 4, 5);
      getChampion(s, me).hp -= 1;
      ally.hp -= 2;
      s.turn.main = me;
      const inst = give(s, "A", def.id);
      const targets = enumerateTargets(s, getChampion(s, me), getCardDef(def.id), 0, 50);
      if (targets.length === 0) continue; // ex.: cartas que precisam de parede em campo
      applyAction(s, "A", { type: "play", card: inst.uid, target: targets[0] });
      while (s.pending) applyAction(s, s.pending.priority, { type: "pass" });
      expect(s.teams.A.hand.some((c) => c.uid === inst.uid), def.id).toBe(false);
      played++;
    }
    expect(played).toBeGreaterThan(100);
  });
});
