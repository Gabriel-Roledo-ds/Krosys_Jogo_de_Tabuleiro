import { describe, it, expect } from "vitest";
import { applyAction, cannotCast, IllegalAction } from "../src/engine/turn";
import { getChampion } from "../src/engine/state";
import { distance } from "../src/engine/board";
import { moveOptionsFor, movementBudget, reachableCells, reachableMap } from "../src/engine/movement";
import { give, hp, place, play, scenario, uid } from "./helpers";

const mkA = () => scenario({ A: ["andarilho", "atirador", "curandeiro"], B: ["atirador", "arquiteto", "enredador"] });
const AND = uid("A", "andarilho");
const ally = uid("A", "atirador");
const e1 = uid("B", "atirador");
const e2 = uid("B", "arquiteto");
const pos = (s: ReturnType<typeof mkA>, u: string) => getChampion(s, u).pos;

describe("Andarilho", () => {
  it("Passo Ágil: +1 de movimento e +1 de mana se andar 5 ou mais casas no turno", () => {
    const s = mkA();
    place(s, AND, 3, 5);
    s.turn.movementLeft = 4;
    s.teams.A.mana = 3;
    applyAction(s, "A", { type: "basic", target: {} });
    expect(s.turn.movementLeft).toBe(5);
    applyAction(s, "A", { type: "move", to: { x: 8, y: 5 } });
    expect(s.teams.A.mana).toBe(4);
  });

  it("Passo Ágil: sem andar 5 casas não rende mana", () => {
    const s = mkA();
    place(s, AND, 3, 5);
    s.turn.movementLeft = 4;
    s.teams.A.mana = 3;
    applyAction(s, "A", { type: "basic", target: {} });
    applyAction(s, "A", { type: "move", to: { x: 6, y: 5 } });
    expect(s.teams.A.mana).toBe(3);
  });

  it("Pés Leves: atravessa aliados e ignora casas lentas", () => {
    const s = mkA();
    place(s, AND, 3, 5);
    place(s, ally, 4, 5);
    const opts = moveOptionsFor(s, getChampion(s, AND));
    expect(opts.passThroughAllies && opts.ignoreSlow).toBe(true);
    s.ground.push({ id: 99, kind: "slow", pos: { x: 3, y: 6 }, damage: 0, remaining: 2, team: "B" });
    const cost = reachableMap(s, getChampion(s, AND), 1, opts).get("3,6")!.cost;
    expect(cost).toBe(1);
  });

  it("Corrida: +3 de movimento neste turno", () => {
    const s = mkA();
    give(s, "A", "corrida");
    s.turn.movementLeft = 2;
    play(s, "A", "corrida");
    expect(s.turn.movementLeft).toBe(5);
  });

  it("Retorno: volta à casa onde começou o turno", () => {
    const s = mkA();
    place(s, AND, 3, 5);
    s.turn.startPositions[AND] = { x: 3, y: 5 };
    s.turn.movementLeft = 3;
    applyAction(s, "A", { type: "move", to: { x: 6, y: 5 } });
    give(s, "A", "retorno");
    play(s, "A", "retorno");
    expect(pos(s, AND)).toEqual({ x: 3, y: 5 });
  });

  it("Puxar: puxa um campeão em linha até 3 casas", () => {
    const s = mkA();
    place(s, AND, 5, 5);
    place(s, e1, 5, 10);
    give(s, "A", "puxar");
    play(s, "A", "puxar", { uid: e1 });
    expect(pos(s, e1)).toEqual({ x: 5, y: 7 });
  });

  it("Puxar exige alvo em linha", () => {
    const s = mkA();
    place(s, AND, 5, 5);
    place(s, e1, 6, 8);
    give(s, "A", "puxar");
    expect(() => play(s, "A", "puxar", { uid: e1 })).toThrow(IllegalAction);
  });

  it("Troca de Lugar: troca de posição com qualquer campeão a até 5 casas", () => {
    const s = mkA();
    place(s, AND, 5, 5);
    place(s, e1, 5, 9);
    give(s, "A", "troca_de_lugar");
    play(s, "A", "troca_de_lugar", { uid: e1 });
    expect(pos(s, AND)).toEqual({ x: 5, y: 9 });
    expect(pos(s, e1)).toEqual({ x: 5, y: 5 });
  });

  it("Impulso Aliado: um aliado a até 3 casas se move 3 casas", () => {
    const s = mkA();
    place(s, AND, 5, 5);
    place(s, ally, 5, 7);
    give(s, "A", "impulso_aliado");
    play(s, "A", "impulso_aliado", { uid: ally, pos: { x: 5, y: 10 } });
    expect(pos(s, ally)).toEqual({ x: 5, y: 10 });
  });

  it("Arrasto: move 4 casas levando junto um aliado adjacente", () => {
    const s = mkA();
    place(s, AND, 5, 5);
    place(s, ally, 5, 6);
    give(s, "A", "arrasto");
    play(s, "A", "arrasto", { pos: { x: 9, y: 5 }, uid2: ally });
    expect(pos(s, AND)).toEqual({ x: 9, y: 5 });
    expect(distance(pos(s, ally), pos(s, AND))).toBe(1);
  });

  it("Investida: move 3 em linha e causa 2 de dano ao primeiro alvo no caminho", () => {
    const s = mkA();
    place(s, AND, 5, 5);
    place(s, e1, 7, 5);
    give(s, "A", "investida");
    play(s, "A", "investida", { dir: { x: 1, y: 0 } });
    expect(pos(s, AND)).toEqual({ x: 6, y: 5 });
    expect(hp(s, e1)).toBe(12);
  });

  it("Salto: teletransporte de até 6 casas", () => {
    const s = mkA();
    place(s, AND, 3, 3);
    give(s, "A", "salto");
    play(s, "A", "salto", { pos: { x: 9, y: 9 } });
    expect(pos(s, AND)).toEqual({ x: 9, y: 9 });
    expect(() => {
      give(s, "A", "salto");
      play(s, "A", "salto", { pos: { x: 0, y: 0 } });
    }).toThrow(IllegalAction);
  });

  it("Vento Lateral: todos os aliados se movem 2 casas", () => {
    const s = mkA();
    place(s, AND, 2, 5);
    place(s, ally, 2, 7);
    place(s, uid("A", "curandeiro"), 2, 9);
    const before = ["andarilho", "atirador", "curandeiro"].map((d) => distance(pos(s, uid("A", d)), s.boss.pos));
    give(s, "A", "vento_lateral");
    play(s, "A", "vento_lateral");
    const after = ["andarilho", "atirador", "curandeiro"].map((d) => distance(pos(s, uid("A", d)), s.boss.pos));
    after.forEach((d, i) => expect(before[i] - d).toBe(2));
  });

  it("Atalho: neste turno o campeão atravessa campeões", () => {
    const s = mkA();
    place(s, AND, 5, 5);
    give(s, "A", "atalho");
    expect(moveOptionsFor(s, getChampion(s, AND)).phasing).toBe(false);
    play(s, "A", "atalho");
    expect(moveOptionsFor(s, getChampion(s, AND)).phasing).toBe(true);
  });
});

// ---------------- Enredador ----------------

const mkE = () => scenario({ A: ["enredador", "atirador", "curandeiro"], B: ["atirador", "arquiteto", "andarilho"] });
const ENR = uid("A", "enredador");
const st = (s: ReturnType<typeof mkE>, u: string, kind: string) => getChampion(s, u).statuses.find((x) => x.kind === kind);

describe("Enredador", () => {
  it("Laço: alvo perde 2 de movimento no próximo turno", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 5, 7);
    applyAction(s, "A", { type: "basic", target: { uid: e1 } });
    expect(st(s, e1, "move_penalty")?.amount).toBe(2);
    expect(movementBudget(s, getChampion(s, e1), 6)).toBe(4);
  });

  it("limite de 1 efeito de controle por campeão por rodada", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 5, 7);
    applyAction(s, "A", { type: "basic", target: { uid: e1 } });
    give(s, "A", "raizes");
    play(s, "A", "raizes", { uid: e1 });
    expect(st(s, e1, "immobilized")).toBeUndefined();
    s.round += 1; // nova rodada: o limite zera
    give(s, "A", "raizes");
    play(s, "A", "raizes", { uid: e1 });
    expect(st(s, e1, "immobilized")).toBeDefined();
  });

  it("Presença Sufocante: inimigos adjacentes perdem 1 no movimento", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 6, 5);
    expect(movementBudget(s, getChampion(s, e1), 5)).toBe(4);
    place(s, e1, 9, 5);
    expect(movementBudget(s, getChampion(s, e1), 5)).toBe(5);
  });

  it("Teia: casa lenta custa 2 para entrar", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 5, 8);
    give(s, "A", "teia");
    play(s, "A", "teia", { pos: { x: 5, y: 7 } });
    const cells = reachableCells(s, getChampion(s, e1), 1, {});
    expect(cells).not.toContainEqual({ x: 5, y: 7 });
    expect(reachableCells(s, getChampion(s, e1), 2, {})).toContainEqual({ x: 5, y: 7 });
  });

  it("Amarras: inimigos adjacentes perdem 2 de movimento", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 6, 5);
    place(s, e2, 9, 9);
    give(s, "A", "amarras");
    play(s, "A", "amarras");
    expect(st(s, e1, "move_penalty")).toBeDefined();
    expect(st(s, e2, "move_penalty")).toBeUndefined();
  });

  it("Empurrão: empurra o alvo 3 casas", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 6, 5);
    give(s, "A", "empurrao");
    play(s, "A", "empurrao", { uid: e1 });
    expect(pos(s, e1)).toEqual({ x: 9, y: 5 });
  });

  it("Empurrão para diante de um sólido", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 6, 5);
    place(s, e2, 8, 5);
    give(s, "A", "empurrao");
    play(s, "A", "empurrao", { uid: e1 });
    expect(pos(s, e1)).toEqual({ x: 7, y: 5 }); // sem dano de colisão
    expect(hp(s, e2)).toBe(20);
  });

  it("Gancho: puxa 2 casas e causa 1 de dano", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 5, 8);
    give(s, "A", "gancho");
    play(s, "A", "gancho", { uid: e1 });
    expect(pos(s, e1)).toEqual({ x: 5, y: 6 });
    expect(hp(s, e1)).toBe(13);
  });

  it("Raízes: alvo não se move no próximo turno", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 5, 7);
    give(s, "A", "raizes");
    play(s, "A", "raizes", { uid: e1 });
    expect(movementBudget(s, getChampion(s, e1), 8)).toBe(0);
  });

  it("Provocar: alvo é obrigado a se mover 3 casas em direção ao Enredador", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 5, 8);
    give(s, "A", "provocar");
    play(s, "A", "provocar", { uid: e1 });
    expect(pos(s, e1)).toEqual({ x: 5, y: 6 }); // para adjacente, sem atravessar
  });

  it("Rede: área 3x3, inimigos perdem 3 de movimento", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 5, 8);
    place(s, e2, 6, 9);
    give(s, "A", "rede");
    play(s, "A", "rede", { pos: { x: 5, y: 8 } });
    expect(st(s, e1, "move_penalty")?.amount).toBe(3);
    expect(st(s, e2, "move_penalty")?.amount).toBe(3);
  });

  it("Elo: dano em um causa metade no outro", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 5, 7);
    place(s, e2, 6, 8);
    give(s, "A", "elo");
    play(s, "A", "elo", { uid: e1, uid2: e2 });
    give(s, "A", "tiro_perfurante");
    // Tiro Perfurante do Atirador a 3 casas: 5 + 1 (Olho Treinado) = 6 em e1 (defesa 0).
    place(s, ally, 5, 4);
    play(s, "A", "tiro_perfurante", { uid: e1 });
    expect(hp(s, e1)).toBe(14 - 6);
    expect(hp(s, e2)).toBe(20 - 3); // metade de 6, sem defesa
  });

  it("Atordoar: alvo não usa a básica nem cartas até gastar o turno", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 5, 8);
    give(s, "A", "atordoar");
    play(s, "A", "atordoar", { uid: e1 });
    expect(st(s, e1, "stunned")).toBeDefined();
    expect(cannotCast(getChampion(s, e1))).toBe(true);
  });

  it("Silêncio: alvo não usa cartas", () => {
    const s = mkE();
    place(s, ENR, 5, 5);
    place(s, e1, 5, 8);
    give(s, "A", "silencio");
    play(s, "A", "silencio", { uid: e1 });
    expect(cannotCast(getChampion(s, e1))).toBe(true);
    expect(cannotCast(getChampion(s, e2))).toBe(false); // vale por campeão
  });
});
