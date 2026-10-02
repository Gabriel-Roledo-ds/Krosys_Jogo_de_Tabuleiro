// Testes da regra "Sistema de reação ao ataque" (claude/monstros-mapa.md), com
// posições e combates fictícios — não depende do tabuleiro hexagonal existir.
// Ver regras-e-decisoes.md §19 "Sequenciamento da implementação".

import { describe, it, expect } from "vitest";
import monstersMap from "../data/monsters_map.json";
import {
  chooseReactionOption,
  decideReaction,
  getMonsterType,
  monsterTypes,
  shouldReact,
  type CombatContext,
} from "../src/design/monsterReaction";

const ctx = (overrides: Partial<CombatContext> = {}): CombatContext => ({
  trigger: "attacked_by_champion",
  attackedBeforeThisCombat: false,
  fledOnceThisCombat: false,
  canFlee: true,
  ...overrides,
});

describe("gatilho da reação", () => {
  it("só reage quando é atacada de propósito, nunca por entrar no alcance ou passar perto", () => {
    expect(shouldReact("attacked_by_champion")).toBe(true);
    expect(shouldReact("entered_range")).toBe(false);
    expect(shouldReact("passed_through")).toBe(false);
  });

  it("decideReaction não reage a entered_range mesmo pra um chefe", () => {
    const tita = getMonsterType("tita_ancestral");
    const result = decideReaction(tita, "entered_range", ctx());
    expect(result.reacted).toBe(false);
  });
});

describe("40 criaturas, 20 tipos, gradiente por nível", () => {
  it("20 tipos, 2 cópias cada, 40 no total, 20 por zona", () => {
    const types = Object.values(monsterTypes);
    expect(types).toHaveLength(20);
    expect(types.reduce((sum, t) => sum + t.copies, 0)).toBe(40);
    const perZone = (zone: string) => types.filter((t) => t.zone === zone).reduce((s, t) => s + t.copies, 0);
    expect(perZone("vale_selvagem")).toBe(20);
    expect(perZone("terra_petrificada")).toBe(20);
  });

  it("nível 1 é sempre 'auto' (1 opção só, sem escolha)", () => {
    for (const t of Object.values(monsterTypes)) {
      if (t.level === 1) {
        expect(t.reaction.kind, t.name).toBe("auto");
        expect(t.reaction.options, t.name).toHaveLength(1);
      }
    }
  });

  it("nível 2 é sempre 'choice' com exatamente 2 opções, sem movimento", () => {
    for (const t of Object.values(monsterTypes)) {
      if (t.level === 2) {
        expect(t.reaction.kind, t.name).toBe("choice");
        expect(t.reaction.options, t.name).toHaveLength(2);
        expect(t.reaction.move, t.name).toBeUndefined();
      }
    }
  });

  it("nível 3 é sempre 'mini_turn' com movimento e repete a cada ataque", () => {
    for (const t of Object.values(monsterTypes)) {
      if (t.level === 3) {
        expect(t.reaction.kind, t.name).toBe("mini_turn");
        expect(t.reaction.options, t.name).toHaveLength(2);
        expect(t.reaction.move, t.name).toBeDefined();
        expect(t.reaction.move!.distance, t.name).toBeGreaterThan(0);
        expect(t.reaction.repeats_on_each_attack, t.name).toBe(true);
        expect(t.is_boss_tier, t.name).toBe(true);
      }
    }
  });

  it("toda criatura tem HP e defesa positivos e uma postura válida", () => {
    const posturas = ["agressiva", "territorial", "evasiva"];
    for (const t of Object.values(monsterTypes)) {
      expect(t.hp, t.name).toBeGreaterThan(0);
      expect(t.defense, t.name).toBeGreaterThanOrEqual(0);
      expect(posturas, t.name).toContain(t.posture);
    }
  });
});

describe("escolha por postura — nível 2 (sem movimento)", () => {
  it("Agressiva (Corvo Caçador) sempre escolhe a opção de dano, mesmo já tendo atacado antes", () => {
    const corvo = getMonsterType("corvo_cacador");
    expect(chooseReactionOption(corvo, ctx()).name).toBe("Bicada");
    expect(chooseReactionOption(corvo, ctx({ attackedBeforeThisCombat: true })).name).toBe("Bicada");
  });

  it("Territorial (Colosso Rachado) usa a opção de mitigação na 1ª vez e dano na 2ª", () => {
    const colosso = getMonsterType("colosso_rachado");
    expect(chooseReactionOption(colosso, ctx({ attackedBeforeThisCombat: false })).name).toBe("Casca Dura");
    expect(chooseReactionOption(colosso, ctx({ attackedBeforeThisCombat: true })).name).toBe("Punho Rachado");
  });

  it("Agressiva nível 1 (Lêmure de Cristal, kind auto) não tem escolha — só a opção única", () => {
    const lemure = getMonsterType("lemure_cristal");
    expect(lemure.reaction.kind).toBe("auto");
    expect(chooseReactionOption(lemure, ctx()).name).toBe("Corte de Cristal");
  });
});

describe("escolha por postura — nível 3 (mini-turno, com movimento)", () => {
  it("Evasiva (Espírito do Vendaval) foge na 1ª vez e só ataca se não puder fugir ou já tiver fugido", () => {
    const vendaval = getMonsterType("espirito_vendaval");
    expect(chooseReactionOption(vendaval, ctx()).name).toBe("Sopro do Vendaval");
    expect(chooseReactionOption(vendaval, ctx({ fledOnceThisCombat: true })).name).toBe("Rajada Cortante");
    expect(chooseReactionOption(vendaval, ctx({ canFlee: false })).name).toBe("Rajada Cortante");
  });

  it("Agressiva (Matriarca da Matilha) sempre vai pra opção de dano/convocação, mesmo podendo fugir", () => {
    const matriarca = getMonsterType("matriarca_matilha");
    const chosen = chooseReactionOption(matriarca, ctx());
    expect(chosen.name).toBe("Convocar Matilha");
  });

  it("Territorial (Titã Ancestral) segue a mesma regra de 1ª vez vs. seguintes do nível 2", () => {
    const tita = getMonsterType("tita_ancestral");
    expect(chooseReactionOption(tita, ctx({ attackedBeforeThisCombat: false })).name).toBe("Erguer Muralha");
    expect(chooseReactionOption(tita, ctx({ attackedBeforeThisCombat: true })).name).toBe("Esmagar");
  });

  it("decideReaction marca moved=true só pra mini_turn (chefes), nunca pra auto/choice", () => {
    const tita = getMonsterType("tita_ancestral");
    const colosso = getMonsterType("colosso_rachado");
    const sentinela = getMonsterType("sentinela_pedra");
    expect(decideReaction(tita, "attacked_by_champion", ctx())).toMatchObject({ reacted: true, moved: true });
    expect(decideReaction(colosso, "attacked_by_champion", ctx())).toMatchObject({ reacted: true, moved: false });
    expect(decideReaction(sentinela, "attacked_by_champion", ctx())).toMatchObject({ reacted: true, moved: false });
  });
});

describe("caso especial: Gárgula Adormecida (evasiva nível 1, mas 'auto')", () => {
  it("só tem a opção de dano e é condicionada ao primeiro ataque no texto, mesmo sendo postura evasiva", () => {
    // Nível 1 é sempre 'auto' (1 opção só) — a postura evasiva nesse caso não abre
    // escolha nenhuma; a condição "só na primeira vez" fica registrada em `condition`
    // pra quando o motor de verdade existir, não é decidida por chooseReactionOption.
    const gargula = getMonsterType("gargula_adormecida");
    expect(gargula.posture).toBe("evasiva");
    expect(gargula.reaction.kind).toBe("auto");
    const option = chooseReactionOption(gargula, ctx());
    expect(option.name).toBe("Despertar Repentino");
    expect(option.condition).toBe("first_attack_received_this_combat");
    expect(option.posture_after).toBe("territorial");
  });
});
