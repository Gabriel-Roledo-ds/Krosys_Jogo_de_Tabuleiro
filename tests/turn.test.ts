import { describe, it, expect } from "vitest";
import { applyAction, IllegalAction, legalActions, startGame } from "../src/engine/turn";
import { createGame, getChampion, type GameState } from "../src/engine/state";
import { resolveDeaths } from "../src/engine/death";
import { give, hp, place, play, scenario, uid } from "./helpers";
import balance from "../data/balance.json";

const COMBO = ["enredador", "piromante", "atirador"];
const TATICO = ["arquiteto", "andarilho", "curandeiro"];
const fresh = (seed = 3): GameState => {
  const s = createGame({ A: COMBO, B: TATICO }, seed);
  startGame(s);
  return s;
};

describe("início da partida e primeiro turno", () => {
  it("primeiro turno: sem compra, mana +1, escolhe o campeão e saca 3 cartas dele", () => {
    const s = fresh();
    expect(s.turn.team).toBe("A");
    expect(s.turn.phase).toBe("choose");
    expect(s.teams.A.mana).toBe(1);
    applyAction(s, "A", { type: "choose", champion: uid("A", "atirador") });
    expect(s.teams.A.hand).toHaveLength(3);
    expect(s.teams.A.hand.every((c) => c.owner === uid("A", "atirador"))).toBe(true);
    expect(s.turn.phase).toBe("act");
    expect(s.turn.die).toBeGreaterThanOrEqual(1);
    expect(s.turn.die).toBeLessThanOrEqual(8);
  });

  it("casas de movimento = dado (sem bônus nem penalidade)", () => {
    const s = fresh();
    applyAction(s, "A", { type: "choose", champion: uid("A", "piromante") });
    expect(s.turn.movementLeft).toBe(s.turn.die);
  });

  it("a equipe errada não pode agir e fases fora de ordem são recusadas", () => {
    const s = fresh();
    expect(() => applyAction(s, "B", { type: "choose", champion: uid("B", "arquiteto") })).toThrow(/turno/);
    expect(() => applyAction(s, "A", { type: "end" })).toThrow(IllegalAction);
    expect(() => applyAction(s, "A", { type: "draw", champion: uid("A", "atirador") })).toThrow(IllegalAction);
  });

  it("mesma seed, mesma partida", () => {
    const run = () => {
      const s = fresh(11);
      applyAction(s, "A", { type: "choose", champion: uid("A", "atirador") });
      return [s.turn.die, s.teams.A.hand.map((c) => c.cardId)];
    };
    expect(run()).toEqual(run());
  });
});

describe("turnos seguintes", () => {
  const playFirstRound = (s: GameState) => {
    applyAction(s, "A", { type: "choose", champion: uid("A", "atirador") });
    applyAction(s, "A", { type: "end" });
    applyAction(s, "B", { type: "choose", champion: uid("B", "andarilho") });
    applyAction(s, "B", { type: "end" });
  };

  it("depois da rodada 1 há fase de compra: escolhe o baralho, saca 1 e ganha mana", () => {
    const s = fresh();
    playFirstRound(s);
    expect(s.round).toBe(2);
    expect(s.turn.team).toBe("A");
    expect(s.turn.phase).toBe("draw");
    const before = s.teams.A.hand.length;
    applyAction(s, "A", { type: "draw", champion: uid("A", "enredador") });
    expect(s.teams.A.hand).toHaveLength(before + 1);
    expect(s.teams.A.hand[before].owner).toBe(uid("A", "enredador"));
    expect(s.teams.A.mana).toBe(2);
    expect(s.turn.phase).toBe("choose");
  });

  it("legalActions lista as ações de cada fase", () => {
    const s = fresh();
    expect(legalActions(s, "A").map((a) => a.type)).toEqual(["choose", "choose", "choose"]);
    expect(legalActions(s, "B")).toEqual([]);
    playFirstRound(s);
    expect(legalActions(s, "A").every((a) => a.type === "draw")).toBe(true);
  });

  it("mão acima de 7: precisa descartar até 7 ao encerrar; cartas de monstro não contam", () => {
    const s = fresh();
    applyAction(s, "A", { type: "choose", champion: uid("A", "atirador") });
    s.teams.A.hand = [];
    for (const id of ["tiro_rapido", "tiro_perfurante", "execucao", "ricochete", "vigia", "mira_total", "disparo_duplo", "recuo_tatico", "marca_cacador"]) give(s, "A", id);
    s.teams.A.hand.push({ uid: "m1", cardId: "faisca_selvagem", owner: uid("A", "atirador"), monster: true });
    applyAction(s, "A", { type: "end" });
    expect(s.turn.phase).toBe("discard");
    applyAction(s, "A", { type: "discard", card: s.teams.A.hand[0].uid });
    expect(s.turn.phase).toBe("discard");
    applyAction(s, "A", { type: "discard", card: s.teams.A.hand[0].uid });
    expect(s.turn.team).toBe("B"); // ficou com 7 (mais 1 de monstro): o turno passou
    expect(s.teams.A.hand).toHaveLength(8);
    expect(() => applyAction(s, "B", { type: "discard", card: "m1" })).toThrow(IllegalAction);
  });

  it("descarte vai para o descarte do baralho do campeão dono", () => {
    const s = fresh();
    applyAction(s, "A", { type: "choose", champion: uid("A", "atirador") });
    s.teams.A.hand = [];
    for (const id of ["tiro_rapido", "tiro_perfurante", "execucao", "ricochete", "vigia", "mira_total", "disparo_duplo", "recuo_tatico"]) give(s, "A", id);
    applyAction(s, "A", { type: "end" });
    const before = s.teams.A.decks[uid("A", "atirador")].discard.length;
    applyAction(s, "A", { type: "discard", card: s.teams.A.hand[0].uid });
    expect(s.teams.A.decks[uid("A", "atirador")].discard.length).toBe(before + 1);
  });

  it("baralho vazio: o descarte é embaralhado de volta", () => {
    const s = fresh();
    playFirstRound(s);
    const d = s.teams.A.decks[uid("A", "enredador")];
    d.discard = d.draw.splice(0);
    applyAction(s, "A", { type: "draw", champion: uid("A", "enredador") });
    expect(d.draw.length + d.discard.length).toBe(9);
  });
});

describe("morte e retorno", () => {
  it("morrer tira o campeão do tabuleiro e guarda a mão dele; volta no início do próximo turno da equipe", () => {
    const s = scenario({ A: ["atirador", "piromante", "curandeiro"], B: ["atirador", "arquiteto", "andarilho"] });
    const victim = uid("B", "atirador");
    place(s, uid("A", "atirador"), 5, 5);
    place(s, victim, 5, 7);
    const c = give(s, "B", "vigia");
    getChampion(s, victim).hp = 2;
    applyAction(s, "A", { type: "basic", target: { uid: victim } });
    expect(s.pending?.priority).toBe("B"); // Vigia é rápida: B pode responder
    applyAction(s, "B", { type: "pass" });
    expect(getChampion(s, victim).alive).toBe(false);
    expect(s.teams.B.hand.some((x) => x.uid === c.uid)).toBe(false);
    applyAction(s, "A", { type: "end" });
    // Turno de B: o campeão volta à largada, imune e com vida cheia.
    const v = getChampion(s, victim);
    expect(v.alive).toBe(true);
    expect(v.hp).toBe(v.maxHp);
    expect(v.untargetable).toBe(true);
    expect(balance.teams.start_areas.B.some((p) => p.x === v.pos.x && p.y === v.pos.y)).toBe(true);
    // As cartas dele voltaram ao baralho.
    const deck = s.teams.B.decks[victim];
    expect([...deck.draw, ...deck.discard].some((x) => x.uid === c.uid)).toBe(true);
  });

  it("imune até o fim do primeiro turno em que for o principal; não pode ser alvo nem atingido por área", () => {
    const s = scenario({ A: ["atirador", "piromante", "curandeiro"], B: ["atirador", "arquiteto", "andarilho"] });
    const back = getChampion(s, uid("B", "arquiteto"));
    back.untargetable = true;
    place(s, uid("A", "atirador"), 5, 5);
    place(s, back.uid, 5, 7);
    expect(() => applyAction(s, "A", { type: "basic", target: { uid: back.uid } })).toThrow(IllegalAction);
    give(s, "A", "explosao");
    place(s, uid("A", "piromante"), 5, 4);
    play(s, "A", "explosao", { pos: { x: 5, y: 7 } });
    expect(back.hp).toBe(20);
  });

  it("perde a imunidade ao fim do turno em que é o principal", () => {
    const s = fresh();
    getChampion(s, uid("A", "atirador")).untargetable = true;
    applyAction(s, "A", { type: "choose", champion: uid("A", "atirador") });
    expect(getChampion(s, uid("A", "atirador")).untargetable).toBe(true);
    applyAction(s, "A", { type: "end" });
    expect(getChampion(s, uid("A", "atirador")).untargetable).toBe(false);
  });

  it("carta de monstro da mão do morto volta ao baralho dele", () => {
    const s = scenario({ A: ["atirador", "piromante", "curandeiro"], B: ["atirador", "arquiteto", "andarilho"] });
    const v = getChampion(s, uid("B", "atirador"));
    s.teams.B.hand.push({ uid: "mc", cardId: "faisca_selvagem", owner: v.uid, monster: true });
    v.hp = 0;
    resolveDeaths(s);
    expect(s.teams.B.hand).toHaveLength(0);
    expect(v.limbo.map((c) => c.uid)).toContain("mc");
  });
});

describe("vitória", () => {
  it("quem dá o último golpe no boss vence e a partida acaba", () => {
    const s = scenario({ A: ["atirador", "piromante", "curandeiro"], B: ["atirador", "arquiteto", "andarilho"] });
    place(s, uid("A", "atirador"), 7, 4);
    s.boss.hp = 2;
    applyAction(s, "A", { type: "basic", target: { uid: "boss" } });
    expect(s.winner).toBe("A");
    expect(s.turn.phase).toBe("over");
    expect(() => applyAction(s, "A", { type: "end" })).toThrow(/terminou/);
  });

  it("último golpe conta mesmo se o boss estava com pouca vida por outra equipe", () => {
    const s = scenario({ A: ["atirador", "piromante", "curandeiro"], B: ["atirador", "arquiteto", "andarilho"] });
    place(s, uid("A", "atirador"), 7, 4);
    s.boss.hp = 1;
    s.boss.lastHitBy = { team: "B", champion: uid("B", "atirador") };
    applyAction(s, "A", { type: "basic", target: { uid: "boss" } });
    expect(s.winner).toBe("A");
  });
});

describe("controle: dura até o campeão gastar um turno", () => {
  it("imobilizado fica com 0 casas no turno dele e depois se liberta", () => {
    const s = fresh();
    const foe = getChampion(s, uid("B", "andarilho"));
    foe.statuses.push({ id: 1, kind: "immobilized", unit: "champion_turns", remaining: 1, negative: true });
    applyAction(s, "A", { type: "choose", champion: uid("A", "atirador") });
    applyAction(s, "A", { type: "end" });
    applyAction(s, "B", { type: "choose", champion: uid("B", "arquiteto") });
    expect(s.turn.movementLeft).toBeGreaterThan(0);
    applyAction(s, "B", { type: "end" });
    // O andarilho não foi escolhido: continua congelado.
    expect(foe.statuses.some((x) => x.kind === "immobilized")).toBe(true);
    applyAction(s, "A", { type: "draw", champion: uid("A", "atirador") });
    applyAction(s, "A", { type: "choose", champion: uid("A", "atirador") });
    applyAction(s, "A", { type: "end" });
    applyAction(s, "B", { type: "draw", champion: uid("B", "andarilho") });
    applyAction(s, "B", { type: "choose", champion: uid("B", "andarilho") });
    expect(s.turn.movementLeft).toBe(0);
    expect(() => applyAction(s, "B", { type: "move", to: { x: 12, y: 8 } })).toThrow(IllegalAction);
    applyAction(s, "B", { type: "end" });
    expect(foe.statuses.some((x) => x.kind === "immobilized")).toBe(false);
  });
});

describe("cartas rápidas e pilha", () => {
  const duel = () => scenario({ A: ["atirador", "piromante", "curandeiro"], B: ["atirador", "curandeiro", "arquiteto"] });

  it("o adversário responde com carta rápida; a última jogada resolve primeiro", () => {
    const s = duel();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, uid("B", "atirador"), 5, 7);
    place(s, uid("B", "curandeiro"), 5, 8);
    give(s, "A", "tiro_perfurante");
    give(s, "B", "escudo");
    play(s, "A", "tiro_perfurante", { uid: uid("B", "atirador") });
    expect(s.pending?.priority).toBe("B");
    expect(hp(s, uid("B", "atirador"))).toBe(14); // ainda não resolveu
    play(s, "B", "escudo", { uid: uid("B", "atirador") });
    expect(s.pending).toBeNull();
    // Escudo 3 resolveu antes: 5 de dano => 3 absorvidos + 2 na vida.
    expect(hp(s, uid("B", "atirador"))).toBe(14 - 2);
  });

  it("passar resolve a pilha", () => {
    const s = duel();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, uid("B", "atirador"), 5, 7);
    give(s, "A", "tiro_perfurante");
    give(s, "B", "escudo");
    play(s, "A", "tiro_perfurante", { uid: uid("B", "atirador") });
    applyAction(s, "B", { type: "pass" });
    expect(hp(s, uid("B", "atirador"))).toBe(14 - 5);
  });

  it("só cartas rápidas respondem, e só quem tem prioridade age", () => {
    const s = duel();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, uid("B", "atirador"), 5, 7);
    place(s, uid("B", "curandeiro"), 5, 8);
    give(s, "A", "tiro_perfurante");
    give(s, "B", "escudo");
    const slow = give(s, "B", "cura");
    play(s, "A", "tiro_perfurante", { uid: uid("B", "atirador") });
    expect(() => applyAction(s, "A", { type: "end" })).toThrow(IllegalAction);
    expect(() => applyAction(s, "B", { type: "play", card: slow.uid, target: { uid: uid("B", "atirador") } })).toThrow(/rápidas/);
  });

  it("sem carta rápida possível, a ação resolve na hora", () => {
    const s = duel();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, uid("B", "atirador"), 5, 7);
    give(s, "A", "tiro_perfurante");
    play(s, "A", "tiro_perfurante", { uid: uid("B", "atirador") });
    expect(s.pending).toBeNull();
    expect(hp(s, uid("B", "atirador"))).toBe(14 - 5);
  });

  it("limite de 3 respostas encadeadas por ação", () => {
    const s = duel();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, uid("A", "curandeiro"), 5, 4);
    place(s, uid("B", "atirador"), 5, 7);
    place(s, uid("B", "curandeiro"), 5, 8);
    give(s, "A", "tiro_perfurante");
    for (let i = 0; i < 4; i++) {
      give(s, "A", "escudo");
      give(s, "B", "escudo");
    }
    play(s, "A", "tiro_perfurante", { uid: uid("B", "atirador") });
    play(s, "B", "escudo", { uid: uid("B", "atirador") });
    expect(s.pending?.priority).toBe("A");
    play(s, "A", "escudo", { uid: uid("A", "atirador") });
    expect(s.pending?.priority).toBe("B");
    play(s, "B", "escudo", { uid: uid("B", "atirador") });
    expect(s.pending).toBeNull(); // 3 respostas: acabou
  });

  it("a morte só é resolvida no fim da pilha: um escudo em resposta salva", () => {
    const s = duel();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, uid("B", "atirador"), 5, 7);
    place(s, uid("B", "curandeiro"), 5, 8);
    getChampion(s, uid("B", "atirador")).hp = 3;
    give(s, "A", "tiro_perfurante");
    give(s, "B", "escudo");
    play(s, "A", "tiro_perfurante", { uid: uid("B", "atirador") });
    play(s, "B", "escudo", { uid: uid("B", "atirador") });
    expect(getChampion(s, uid("B", "atirador")).alive).toBe(true);
    expect(hp(s, uid("B", "atirador"))).toBe(1);
  });

  it("carta rápida bloqueada por silêncio", () => {
    const s = duel();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, uid("B", "atirador"), 5, 7);
    getChampion(s, uid("B", "curandeiro")).statuses.push({ id: 1, kind: "silenced", unit: "champion_turns", remaining: 1, negative: true });
    give(s, "A", "tiro_perfurante");
    give(s, "B", "escudo");
    play(s, "A", "tiro_perfurante", { uid: uid("B", "atirador") });
    expect(s.pending).toBeNull(); // o dono do Escudo está silenciado: sem resposta possível
  });
});

describe("monstros", () => {
  const withMonsters = () => {
    const s = createGame({ A: ["atirador", "piromante", "curandeiro"], B: ["atirador", "arquiteto", "andarilho"] }, 5);
    startGame(s);
    applyAction(s, "A", { type: "choose", champion: uid("A", "atirador") });
    return s;
  };

  it("monstro ataca quem termina o movimento dentro do alcance dele", () => {
    const s = withMonsters();
    const m = s.monsters.find((x) => x.type === "weak")!; // alcance 1, ataque 1
    const c = getChampion(s, uid("A", "atirador"));
    c.pos = { x: m.pos.x - 3, y: m.pos.y };
    s.turn.movementLeft = 8;
    applyAction(s, "A", { type: "move", to: { x: m.pos.x - 1, y: m.pos.y } });
    expect(c.hp).toBe(14 - 1);
  });

  it("não ataca se o campeão para fora do alcance", () => {
    const s = withMonsters();
    const m = s.monsters.find((x) => x.type === "weak")!;
    const c = getChampion(s, uid("A", "atirador"));
    c.pos = { x: m.pos.x - 4, y: m.pos.y };
    s.turn.movementLeft = 8;
    applyAction(s, "A", { type: "move", to: { x: m.pos.x - 2, y: m.pos.y } });
    expect(c.hp).toBe(14);
  });

  it("monstro derrotado dá a carta fixa a quem deu o último hit, e não conta no limite", () => {
    const s = withMonsters();
    const m = s.monsters.find((x) => x.type === "weak")!;
    const c = getChampion(s, uid("A", "atirador"));
    c.pos = { x: m.pos.x - 3, y: m.pos.y };
    m.hp = 1;
    applyAction(s, "A", { type: "basic", target: { uid: m.uid } });
    expect(m.alive).toBe(false);
    const reward = s.teams.A.hand.find((x) => x.cardId === "faisca_selvagem")!;
    expect(reward.monster).toBe(true);
    expect(reward.owner).toBe(c.uid);
  });

  it("monstro forte reduz em 1 o movimento de quem está adjacente", () => {
    const s = withMonsters();
    const m = s.monsters.find((x) => x.type === "strong")!;
    const c = getChampion(s, uid("A", "atirador"));
    c.pos = { x: m.pos.x - 1, y: m.pos.y };
    s.teams.A.turnsTaken = 1;
    s.turn.main = null;
    s.turn.phase = "choose";
    applyAction(s, "A", { type: "choose", champion: c.uid });
    expect(s.turn.movementLeft).toBe(Math.max(0, s.turn.die - 1));
  });

  it("monstro médio reflete 1 de dano em quem bate de perto", () => {
    const s = withMonsters();
    const m = s.monsters.find((x) => x.type === "medium")!;
    const c = getChampion(s, uid("A", "atirador"));
    c.pos = { x: m.pos.x - 1, y: m.pos.y };
    c.hp = 10;
    applyAction(s, "A", { type: "basic", target: { uid: m.uid } });
    expect(c.hp).toBe(9);
  });

  it("monstro fraco regenera 1 por rodada", () => {
    const s = withMonsters();
    const m = s.monsters.find((x) => x.type === "weak")!;
    m.hp = 2;
    // fim de rodada
    applyAction(s, "A", { type: "end" });
    applyAction(s, "B", { type: "choose", champion: uid("B", "arquiteto") });
    applyAction(s, "B", { type: "end" });
    expect(m.hp).toBe(3);
  });

  it("cartas de monstro: usar a Couraça dá escudo 4 e a carta some", () => {
    const s = scenario({ A: ["atirador", "piromante", "curandeiro"], B: ["atirador", "arquiteto", "andarilho"] });
    s.teams.A.hand.push({ uid: "rc", cardId: "couraca", owner: uid("A", "atirador"), monster: true });
    place(s, uid("A", "atirador"), 5, 5);
    play(s, "A", "couraca", { uid: uid("A", "atirador") });
    expect(getChampion(s, uid("A", "atirador")).shield).toBe(4);
    expect(s.teams.A.hand.some((c) => c.uid === "rc")).toBe(false);
  });

  it("Faísca Selvagem (dano 2) e Investida Bruta (dano 5 e empurra 1)", () => {
    const s = scenario({ A: ["atirador", "piromante", "curandeiro"], B: ["atirador", "arquiteto", "andarilho"] });
    s.teams.A.hand.push({ uid: "r1", cardId: "faisca_selvagem", owner: uid("A", "atirador"), monster: true });
    s.teams.A.hand.push({ uid: "r2", cardId: "investida_bruta", owner: uid("A", "atirador"), monster: true });
    place(s, uid("A", "atirador"), 5, 5);
    place(s, uid("B", "atirador"), 5, 7);
    play(s, "A", "faisca_selvagem", { uid: uid("B", "atirador") });
    expect(hp(s, uid("B", "atirador"))).toBe(12);
    play(s, "A", "investida_bruta", { uid: uid("B", "atirador") });
    expect(hp(s, uid("B", "atirador"))).toBe(7);
    expect(getChampion(s, uid("B", "atirador")).pos).toEqual({ x: 5, y: 8 });
  });
});
