import { describe, it, expect } from "vitest";
import { applyAction } from "../src/engine/turn";
import { getChampion } from "../src/engine/state";
import { onLand } from "../src/engine/hazards";
import { resolveDeaths } from "../src/engine/death";
import { moveOptionsFor, reachableCells } from "../src/engine/movement";
import { hasLineOfSight } from "../src/engine/world";
import { tickRound } from "../src/engine/tick";
import { give, hp, place, play, scenario, uid } from "./helpers";

// ---------------- Curandeiro ----------------

const mkC = () => scenario({ A: ["curandeiro", "atirador", "arquiteto"], B: ["atirador", "enredador", "andarilho"] });
const CUR = uid("A", "curandeiro");
const ally = uid("A", "atirador");
const tank = uid("A", "arquiteto");
const e1 = uid("B", "atirador");
const e2 = uid("B", "enredador");
const hurt = (s: ReturnType<typeof mkC>, u: string, dmg: number) => (getChampion(s, u).hp -= dmg);

describe("Curandeiro", () => {
  it("Toque: cura 1 e a passiva cura 1 nele mesmo", () => {
    const s = mkC();
    place(s, CUR, 5, 5);
    place(s, ally, 5, 6);
    hurt(s, ally, 5);
    hurt(s, CUR, 3);
    applyAction(s, "A", { type: "basic", target: { uid: ally } });
    expect(hp(s, ally)).toBe(14 - 5 + 1);
    expect(hp(s, CUR)).toBe(16 - 3 + 1);
  });

  it("Bênção (rápida): cura 2", () => {
    const s = mkC();
    place(s, CUR, 5, 5);
    place(s, ally, 5, 6);
    hurt(s, ally, 6);
    give(s, "A", "bencao");
    play(s, "A", "bencao", { uid: ally });
    expect(hp(s, ally)).toBe(14 - 6 + 2);
  });

  it("Cura: 4 e nunca passa da vida máxima", () => {
    const s = mkC();
    place(s, CUR, 5, 5);
    place(s, ally, 5, 6);
    hurt(s, ally, 2);
    give(s, "A", "cura");
    play(s, "A", "cura", { uid: ally });
    expect(hp(s, ally)).toBe(14);
  });

  it("Purificar (rápida): remove efeitos negativos e descongela", () => {
    const s = mkC();
    place(s, CUR, 5, 5);
    place(s, ally, 5, 6);
    getChampion(s, ally).statuses.push({ id: 1, kind: "immobilized", unit: "champion_turns", remaining: 1, negative: true });
    give(s, "A", "purificar");
    play(s, "A", "purificar", { uid: ally });
    expect(getChampion(s, ally).statuses).toHaveLength(0);
  });

  it("Sacrifício: perde 2 de vida e o aliado recupera 4", () => {
    const s = mkC();
    place(s, CUR, 5, 5);
    place(s, ally, 5, 6);
    hurt(s, ally, 6);
    give(s, "A", "sacrificio");
    play(s, "A", "sacrificio", { uid: ally });
    expect(hp(s, CUR)).toBe(16 - 2 + 1); // passiva devolve 1
    expect(hp(s, ally)).toBe(14 - 6 + 4);
  });

  it("Escudo (rápida): absorve 3 antes da vida", () => {
    const s = mkC();
    place(s, CUR, 5, 5);
    place(s, ally, 5, 6);
    give(s, "A", "escudo");
    play(s, "A", "escudo", { uid: ally });
    expect(getChampion(s, ally).shield).toBe(3);
    place(s, e1, 5, 9);
    give(s, "B", "tiro_perfurante"); // dano 5 + 1 = 6 a 3 casas: 3 absorvidos
    s.turn.team = "B";
    s.turn.phase = "act";
    s.turn.main = e1;
    play(s, "B", "tiro_perfurante", { uid: ally });
    expect(getChampion(s, ally).shield).toBe(0);
    expect(hp(s, ally)).toBe(14 - 3);
  });

  it("Escudo Reativo (rápida): absorve 2 e reflete 1 de dano ao atacante", () => {
    const s = mkC();
    place(s, CUR, 5, 5);
    place(s, ally, 5, 6);
    give(s, "A", "escudo_reativo");
    play(s, "A", "escudo_reativo", { uid: ally });
    expect(getChampion(s, ally).shield).toBe(2);
    place(s, e1, 5, 9);
    give(s, "B", "tiro_rapido"); // 2 + 1 = 3: 2 absorvidos, 1 na vida
    s.turn.team = "B";
    s.turn.phase = "act";
    s.turn.main = e1;
    play(s, "B", "tiro_rapido", { uid: ally });
    expect(hp(s, ally)).toBe(13);
    expect(hp(s, e1)).toBe(13); // refletiu 1
  });

  it("Regeneração: cura 1 por rodada durante 3 rodadas", () => {
    const s = mkC();
    place(s, CUR, 5, 5);
    place(s, ally, 5, 6);
    hurt(s, ally, 8);
    give(s, "A", "regeneracao");
    play(s, "A", "regeneracao", { uid: ally });
    for (let i = 0; i < 5; i++) tickRound(s);
    expect(hp(s, ally)).toBe(14 - 8 + 3);
  });

  it("Aura Vital: cura 2 em todos os aliados em raio 2", () => {
    const s = mkC();
    place(s, CUR, 5, 5);
    place(s, ally, 5, 6);
    place(s, tank, 7, 5);
    hurt(s, ally, 5);
    hurt(s, tank, 5);
    give(s, "A", "aura_vital");
    play(s, "A", "aura_vital");
    expect(hp(s, ally)).toBe(14 - 5 + 2);
    expect(hp(s, tank)).toBe(20 - 5 + 2);
  });

  it("Santuário: aliados na área ficam imunes a controle por 2 rodadas", () => {
    const s = mkC();
    place(s, CUR, 5, 5);
    place(s, ally, 5, 6);
    give(s, "A", "santuario");
    play(s, "A", "santuario", { pos: { x: 5, y: 6 } });
    expect(getChampion(s, ally).statuses.some((x) => x.kind === "control_immune")).toBe(true);
  });

  it("Ressurgir: aliado morto volta na hora com a mão preservada, 1 vez por partida", () => {
    const s = mkC();
    place(s, CUR, 5, 5);
    place(s, ally, 5, 6);
    const card = give(s, "A", "tiro_rapido");
    getChampion(s, ally).hp = 0;
    resolveDeaths(s);
    expect(getChampion(s, ally).alive).toBe(false);
    expect(s.teams.A.hand.some((c) => c.uid === card.uid)).toBe(false); // a mão espera com ele
    give(s, "A", "ressurgir");
    play(s, "A", "ressurgir", { uid: ally });
    expect(getChampion(s, ally).alive).toBe(true);
    expect(s.teams.A.hand.some((c) => c.uid === card.uid)).toBe(true);
    expect(s.teams.A.resurrectUsed).toBe(true);
  });
});

// ---------------- Arquiteto ----------------

const mkAr = () => scenario({ A: ["arquiteto", "atirador", "curandeiro"], B: ["atirador", "curandeiro", "andarilho"] });
const ARQ = uid("A", "arquiteto");
const wallAt = (s: ReturnType<typeof mkAr>, x: number, y: number) => s.walls.find((w) => w.pos.x === x && w.pos.y === y);

describe("Arquiteto", () => {
  it("Barreira: cria uma parede fraca (2 de vida + 2 do Engenheiro) que expira", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    applyAction(s, "A", { type: "basic", target: { pos: { x: 5, y: 6 } } });
    const w = wallAt(s, 5, 6)!;
    expect(w.kind).toBe("weak");
    expect(w.hp).toBe(4);
    for (let i = 0; i < 3; i++) tickRound(s);
    expect(wallAt(s, 5, 6)).toBeUndefined();
  });

  it("paredes bloqueiam movimento, exceto para o Arquiteto em paredes dele", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    place(s, uid("A", "atirador"), 5, 4);
    applyAction(s, "A", { type: "basic", target: { pos: { x: 6, y: 5 } } });
    const other = getChampion(s, uid("A", "atirador"));
    expect(reachableCells(s, other, 1, {})).not.toContainEqual({ x: 6, y: 5 });
    expect(reachableCells(s, getChampion(s, ARQ), 2, moveOptionsFor(s, getChampion(s, ARQ)))).toContainEqual({ x: 7, y: 5 });
  });

  it("Estaca (rápida): parede baixa bloqueia movimento mas não a linha de visão", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    give(s, "A", "estaca");
    play(s, "A", "estaca", { pos: { x: 5, y: 6 } });
    expect(wallAt(s, 5, 6)!.kind).toBe("low");
    expect(hasLineOfSight(s, { x: 5, y: 5 }, { x: 5, y: 7 })).toBe(true);
  });

  it("parede normal bloqueia a linha de visão", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    give(s, "A", "muralha");
    play(s, "A", "muralha", { pos: { x: 4, y: 6 }, dir: { x: 1, y: 0 } });
    expect(hasLineOfSight(s, { x: 5, y: 5 }, { x: 5, y: 7 })).toBe(false);
  });

  it("Reforçar: +3 de vida e a parede vira permanente", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    applyAction(s, "A", { type: "basic", target: { pos: { x: 5, y: 6 } } });
    give(s, "A", "reforcar");
    play(s, "A", "reforcar", { pos: { x: 5, y: 6 } });
    expect(wallAt(s, 5, 6)).toMatchObject({ hp: 7, remaining: null });
    for (let i = 0; i < 6; i++) tickRound(s);
    expect(wallAt(s, 5, 6)).toBeDefined();
  });

  it("Demolir: destrói a parede e causa 2 de dano a quem estiver adjacente", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    applyAction(s, "A", { type: "basic", target: { pos: { x: 5, y: 6 } } });
    place(s, uid("B", "atirador"), 6, 7);
    give(s, "A", "demolir");
    play(s, "A", "demolir", { pos: { x: 5, y: 6 } });
    expect(wallAt(s, 5, 6)).toBeUndefined();
    expect(hp(s, uid("B", "atirador"))).toBe(12);
  });

  it("Muralha: 3 paredes em linha por 3 rodadas", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    give(s, "A", "muralha");
    play(s, "A", "muralha", { pos: { x: 4, y: 7 }, dir: { x: 1, y: 0 } });
    expect(s.walls).toHaveLength(3);
    for (let i = 0; i < 3; i++) tickRound(s);
    expect(s.walls).toHaveLength(0);
  });

  it("Armadilha: 3 de dano a quem pisar, uma vez", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    give(s, "A", "armadilha");
    play(s, "A", "armadilha", { pos: { x: 5, y: 7 } });
    const foe = uid("B", "atirador");
    place(s, foe, 5, 7);
    onLand(s, getChampion(s, foe), { voluntary: true });
    expect(hp(s, foe)).toBe(11);
    expect(s.traps).toHaveLength(0);
  });

  it("Mola: lança quem pisar 3 casas na direção escolhida", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    give(s, "A", "mola");
    play(s, "A", "mola", { pos: { x: 5, y: 8 }, dir: { x: 1, y: 0 } });
    const foe = uid("B", "atirador");
    place(s, foe, 5, 8);
    onLand(s, getChampion(s, foe), { voluntary: true });
    expect(getChampion(s, foe).pos).toEqual({ x: 8, y: 8 });
  });

  it("Barricada: 5 paredes em L", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    give(s, "A", "barricada");
    play(s, "A", "barricada", { pos: { x: 4, y: 7 }, dir: { x: 1, y: 0 } });
    expect(s.walls).toHaveLength(5);
  });

  it("Torre de Vigia: 2 de dano por rodada a inimigos em alcance 3", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    give(s, "A", "torre_de_vigia");
    play(s, "A", "torre_de_vigia", { pos: { x: 5, y: 7 } });
    expect(s.structures[0].hp).toBe(3 + 2); // Engenheiro
    place(s, uid("B", "andarilho"), 5, 9);
    tickRound(s);
    expect(hp(s, uid("B", "andarilho"))).toBe(14); // 16 - 2, ignora defesa
    expect(hp(s, uid("A", "atirador"))).toBe(14); // aliados não sofrem
  });

  it("Portal: campeão que para em um portal aparece no outro", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    give(s, "A", "portal");
    play(s, "A", "portal", { pos: { x: 5, y: 6 }, pos2: { x: 8, y: 6 } });
    const foe = uid("B", "atirador");
    place(s, foe, 5, 6);
    onLand(s, getChampion(s, foe), { voluntary: true });
    expect(getChampion(s, foe).pos).toEqual({ x: 8, y: 6 });
  });

  it("Cúpula: paredes 3x3 ao redor de um aliado", () => {
    const s = mkAr();
    place(s, ARQ, 5, 5);
    place(s, uid("A", "atirador"), 5, 7);
    give(s, "A", "cupula");
    play(s, "A", "cupula", { uid: uid("A", "atirador") });
    expect(s.walls).toHaveLength(8);
  });
});
