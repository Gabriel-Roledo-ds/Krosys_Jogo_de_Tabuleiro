import { describe, expect, it } from "vitest";
import { createGame } from "../src/engine/state";
import { startGame } from "../src/engine/turn";
import { viewFor } from "../src/server/view";
import { sanitizeAction, validComp } from "../src/server/rooms";

describe("servidor", () => {
  const s = createGame({ A: ["atirador", "piromante", "curandeiro"], B: ["arquiteto", "andarilho", "enredador"] }, 7);
  startGame(s);

  it("não revela a mão nem a ordem dos baralhos do adversário", () => {
    const v: any = viewFor(s, "A");
    expect(v.teams.B.hand).toBeUndefined();
    expect(typeof v.boss.deck).toBe("number");
    expect(v.rngState).toBeUndefined();
  });

  it("oculta armadilhas do outro time", () => {
    s.traps.push({ id: 99, pos: { x: 3, y: 3 }, damage: 2, team: "B" });
    expect((viewFor(s, "A") as any).traps).toHaveLength(0);
    expect((viewFor(s, "B") as any).traps).toHaveLength(1);
    s.traps.pop();
  });

  it("valida o formato das ações recebidas", () => {
    expect(sanitizeAction({ type: "move", to: { x: 1, y: 2 } })).toEqual({ type: "move", to: { x: 1, y: 2 } });
    expect(sanitizeAction({ type: "move", to: { x: "a" } })).toBeNull();
    expect(sanitizeAction({ type: "hack" })).toBeNull();
    expect(sanitizeAction(null)).toBeNull();
    expect(sanitizeAction({ type: "play", card: "c1", target: { uid: 5 } })).toBeNull();
  });

  it("aceita só composições de 3 campeões diferentes e existentes", () => {
    expect(validComp(["atirador", "piromante", "curandeiro"])).toBe(true);
    expect(validComp(["atirador", "atirador", "curandeiro"])).toBe(false);
    expect(validComp(["atirador", "piromante"])).toBe(false);
    expect(validComp(["atirador", "piromante", "xyz"])).toBe(false);
  });
});
