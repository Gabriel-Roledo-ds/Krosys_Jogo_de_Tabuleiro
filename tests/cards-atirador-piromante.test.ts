import { describe, it, expect } from "vitest";
import { applyAction, IllegalAction } from "../src/engine/turn";
import { getChampion } from "../src/engine/state";
import { distance } from "../src/engine/board";
import { onLand } from "../src/engine/hazards";
import { give, hp, place, play, scenario, uid } from "./helpers";

// Equipe B: alvos de teste. B-atirador (defesa 0, vida 14), B-arquiteto (defesa 2, vida 20), B-enredador (defesa 1, vida 18).
const atirador = () => scenario({ A: ["atirador", "piromante", "curandeiro"], B: ["atirador", "arquiteto", "enredador"] });
const dummy = uid("B", "atirador");
const tank = uid("B", "arquiteto");
const mid = uid("B", "enredador");

describe("Atirador: básica e passiva", () => {
  it("Disparo: dano 2, alcance 4, +1 de Olho Treinado a 3 ou mais casas", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 8); // distância 3
    applyAction(s, "A", { type: "basic", target: { uid: dummy } });
    expect(hp(s, dummy)).toBe(14 - 3);
  });

  it("Disparo de perto não ganha o bônus", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 7); // distância 2
    applyAction(s, "A", { type: "basic", target: { uid: dummy } });
    expect(hp(s, dummy)).toBe(14 - 2);
  });

  it("recusa alvo fora do alcance 4 e a segunda básica no mesmo turno", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 10);
    expect(() => applyAction(s, "A", { type: "basic", target: { uid: dummy } })).toThrow(IllegalAction);
    place(s, dummy, 5, 7);
    applyAction(s, "A", { type: "basic", target: { uid: dummy } });
    expect(() => applyAction(s, "A", { type: "basic", target: { uid: dummy } })).toThrow(/já foi usada/);
  });

  it("defesa subtrai e o dano mínimo é 1", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, tank, 5, 7); // defesa 2, dano 2 => mínimo 1
    applyAction(s, "A", { type: "basic", target: { uid: tank } });
    expect(hp(s, tank)).toBe(20 - 1);
  });
});

describe("Atirador: 10 cartas", () => {
  it("Tiro Rápido: dano 2 com alcance 5", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 10);
    give(s, "A", "tiro_rapido");
    play(s, "A", "tiro_rapido", { uid: dummy });
    expect(hp(s, dummy)).toBe(14 - 3); // 2 + Olho Treinado
    expect(s.teams.A.mana).toBe(9);
  });

  it("Recuo Tático: move 2 casas para longe do alvo", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 6, 5);
    give(s, "A", "recuo_tatico");
    play(s, "A", "recuo_tatico", { uid: dummy });
    expect(distance(getChampion(s, uid("A", "atirador")).pos, getChampion(s, dummy).pos)).toBe(3);
  });

  it("Marca do Caçador: alvo marcado recebe +2 de qualquer fonte", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 7);
    give(s, "A", "marca_cacador");
    play(s, "A", "marca_cacador", { uid: dummy });
    applyAction(s, "A", { type: "basic", target: { uid: dummy } });
    expect(hp(s, dummy)).toBe(14 - 4); // 2 + 2
  });

  it("Tiro na Perna: dano 1 e perde 2 de movimento no próximo turno dele", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 7);
    give(s, "A", "tiro_na_perna");
    play(s, "A", "tiro_na_perna", { uid: dummy });
    expect(hp(s, dummy)).toBe(13);
    const st = getChampion(s, dummy).statuses.find((x) => x.kind === "move_penalty")!;
    expect([st.amount, st.unit]).toEqual([2, "champion_turns"]);
  });

  it("Vigia: rápida; o próximo inimigo que entra no alcance 5 leva 3 de dano", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 12);
    give(s, "A", "vigia");
    play(s, "A", "vigia");
    expect(s.watches).toHaveLength(1);
    place(s, dummy, 5, 9); // distância 4
    onLand(s, getChampion(s, dummy), { voluntary: true });
    expect(hp(s, dummy)).toBe(14 - 4); // 3 + Olho Treinado (distância >= 3)
    expect(s.watches).toHaveLength(0);
  });

  it("Tiro Perfurante: dano 5", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 8);
    give(s, "A", "tiro_perfurante");
    play(s, "A", "tiro_perfurante", { uid: dummy });
    expect(hp(s, dummy)).toBe(14 - 6);
  });

  it("Disparo Duplo: dois tiros de 2 em alvos diferentes", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 7);
    place(s, mid, 6, 7);
    give(s, "A", "disparo_duplo");
    play(s, "A", "disparo_duplo", { uid: dummy, uid2: mid });
    expect(hp(s, dummy)).toBe(12);
    expect(hp(s, mid)).toBe(18 - 1); // 2 - defesa 1
  });

  it("Disparo Duplo exige alvos diferentes", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 7);
    give(s, "A", "disparo_duplo");
    expect(() => play(s, "A", "disparo_duplo", { uid: dummy, uid2: dummy })).toThrow(IllegalAction);
  });

  it("Ricochete: 3 no primeiro e 2 no mais próximo a até 2 casas", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 7);
    place(s, tank, 5, 9); // a 2 casas do primeiro
    give(s, "A", "ricochete");
    play(s, "A", "ricochete", { uid: dummy });
    expect(hp(s, dummy)).toBe(14 - 3);
    expect(hp(s, tank)).toBe(20 - 1); // 2 - defesa 2 => mínimo 1
  });

  it("Mira Total: próxima carta ganha +3 de alcance e +2 de dano", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 6, 1);
    place(s, dummy, 6, 8); // distância 7 = alcance 4 + 3
    give(s, "A", "mira_total");
    give(s, "A", "tiro_perfurante");
    play(s, "A", "mira_total");
    play(s, "A", "tiro_perfurante", { uid: dummy });
    expect(hp(s, dummy)).toBe(14 - 8); // 5 + 2 + 1 (Olho Treinado)
    expect(s.teams.A.mana).toBe(10 - 4 - 3);
    expect(s.teams.A.nextCardBuff).toBeNull(); // consumida
  });

  it("Execução: dano 8 sem marca", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 7);
    give(s, "A", "execucao");
    play(s, "A", "execucao", { uid: dummy });
    expect(hp(s, dummy)).toBe(14 - 8); // distância 2: sem bônus do Olho Treinado
  });
});

describe("Execução com marca", () => {
  it("alvo marcado: 12 no total, com a marca já incluída (opção A)", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 5);
    place(s, dummy, 5, 7);
    give(s, "A", "marca_cacador");
    give(s, "A", "execucao");
    play(s, "A", "marca_cacador", { uid: dummy });
    play(s, "A", "execucao", { uid: dummy });
    expect(hp(s, dummy)).toBe(14 - 12);
    expect(s.teams.A.mana).toBe(10 - 2 - 5);
  });

  it("no boss (defesa 1) a Execução marcada causa 11", () => {
    const s = atirador();
    place(s, uid("A", "atirador"), 5, 7);
    give(s, "A", "marca_cacador");
    give(s, "A", "execucao");
    play(s, "A", "marca_cacador", { uid: "boss" });
    play(s, "A", "execucao", { uid: "boss" });
    expect(s.boss.hp).toBe(s.boss.maxHp - 11);
  });
});
