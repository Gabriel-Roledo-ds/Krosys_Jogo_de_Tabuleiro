import { describe, expect, it } from "vitest";
import { createGameV2 } from "../src/engine-v2/state";
import { startGameV2 } from "../src/engine-v2/turn";
import { viewForV2 } from "../src/server/view-v2";
import {
  addBot,
  createRoom,
  handleAction,
  sanitizeAction,
  scheduleBots,
  startRoom,
  validComp,
} from "../src/server/rooms-v2";

describe("servidor v2", () => {
  const s = createGameV2(7, { comp: { A: ["niara", "varek", "selene"], B: ["borak", "dorin", "aurelia"] } });
  startGameV2(s);

  it("não revela a mão nem a ordem dos baralhos do adversário", () => {
    const v: any = viewForV2(s, "A");
    expect(v.teams.B.hand).toBeUndefined();
    expect(typeof v.boss.deck).toBe("number");
    expect(v.rngState).toBeUndefined();
  });

  it("valida o formato das ações recebidas (coordenadas axiais q,r)", () => {
    expect(sanitizeAction({ type: "move", to: { q: 1, r: 2 } })).toEqual({ type: "move", to: { q: 1, r: 2 } });
    expect(sanitizeAction({ type: "move", to: { q: "a" } })).toBeNull();
    expect(sanitizeAction({ type: "hack" })).toBeNull();
    expect(sanitizeAction(null)).toBeNull();
    expect(sanitizeAction({ type: "play", card: "c1", rank: 1, target: { uid: 5 } })).toBeNull();
    expect(sanitizeAction({ type: "play", card: "c1", target: { uid: "boss" } })).toBeNull(); // falta rank
    expect(sanitizeAction({ type: "play", card: "c1", rank: 1, target: { uid: "boss" } })).toEqual({
      type: "play",
      card: "c1",
      rank: 1,
      target: { uid: "boss" },
    });
    expect(sanitizeAction({ type: "basic", champion: "A-niara", target: {} })).toEqual({
      type: "basic",
      champion: "A-niara",
      target: {},
    });
  });

  // Achado desta sessão: o motor (turn.ts/sacrifice.ts) já suportava a ação
  // "sacrifice" de ponta a ponta, mas sanitizeAction não tinha case pra ela —
  // toda ação de sacrifício vinda da rede caía no `default: return null` e
  // era descartada antes de chegar no motor (cliente nunca tinha UI pra isso
  // também, ver board/main.ts). Mesma lacuna pro toggle de janela rápida.
  it("aceita a ação de sacrifício e o toggle de janela rápida (antes caíam no default: null)", () => {
    expect(sanitizeAction({ type: "sacrifice", champion: "A-niara" })).toEqual({
      type: "sacrifice",
      champion: "A-niara",
      target: undefined,
    });
    expect(sanitizeAction({ type: "sacrifice", champion: "A-varek", target: "A-niara" })).toEqual({
      type: "sacrifice",
      champion: "A-varek",
      target: "A-niara",
    });
    expect(sanitizeAction({ type: "sacrifice", target: "A-niara" })).toBeNull(); // falta champion
    expect(sanitizeAction({ type: "sacrifice", champion: "A-niara", target: 5 })).toBeNull();
    expect(sanitizeAction({ type: "toggleFast", enabled: false })).toEqual({ type: "toggleFast", enabled: false });
    expect(sanitizeAction({ type: "toggleFast", enabled: "no" })).toBeNull();
    expect(sanitizeAction({ type: "toggleFast" })).toBeNull();
  });

  it("aceita só composições de 3 campeões diferentes e existentes do roster v2", () => {
    expect(validComp(["niara", "varek", "selene"])).toBe(true);
    expect(validComp(["niara", "niara", "selene"])).toBe(false);
    expect(validComp(["niara", "varek"])).toBe(false);
    expect(validComp(["niara", "varek", "xyz"])).toBe(false);
    expect(validComp(["atirador", "piromante", "curandeiro"])).toBe(false); // roster do MVP, não do v2
  });
});

describe("salas v2: fluxo completo", () => {
  it("cria sala, adiciona bot, escolhe campeões, começa e aplica ações válidas/invalidas", () => {
    const fakeWs = { readyState: 0, send: () => {} } as any;
    const { room, team } = createRoom(fakeWs, "Gabe");
    expect(team).toBe("A");
    expect(room.seats.A?.name).toBe("Gabe");

    expect(addBot(room)).toBe(true);
    expect(room.seats.B?.bot).toBe(true);

    const seatA = room.seats.A!;
    seatA.comp = ["niara", "varek", "selene"];

    const err = startRoom(room);
    expect(err).toBeNull();
    expect(room.state).not.toBeNull();
    expect(room.state!.teams.A.champions.map((c) => c.defId)).toEqual(["niara", "varek", "selene"]);

    const noop = () => {};
    // Ação inválida: não é a fase de ação ainda (começa em "draw" ou já pulou pra "act"
    // se nenhum campeão tiver carta pra comprar — qualquer ação de jogo antes da hora falha).
    const invalidErr = handleAction(room, "A", { type: "end" } as any, noop);
    expect(typeof invalidErr === "string" || invalidErr === null).toBe(true);
    if (room.state!.turn.phase !== "act") {
      expect(invalidErr).not.toBeNull();
    }

    // Avança a fase de compra de A (se for a vez dela) com uma ação válida.
    if (room.state!.turn.team === "A" && room.state!.turn.phase === "draw") {
      const champ = room.state!.teams.A.champions[0];
      const drawErr = handleAction(room, "A", { type: "draw", champion: champ.uid } as any, noop);
      expect(drawErr).toBeNull();
      expect(room.state!.turn.phase).toBe("act");
    }

    // Ação claramente inválida: campeão inexistente (erro, seja do motor ou de validação).
    const badErr = handleAction(room, "A", { type: "stay", champion: "inexistente" } as any, noop);
    expect(typeof badErr).toBe("string");

    scheduleBots(room, noop);
  });
});
