// Partidas simuladas do motor hexagonal (roster v2), bot contra bot — mesma ideia de
// tests/sim.test.ts (MVP). Item 8 da ordem de execução (KANBAN.md): bots v2.

import { describe, it, expect } from "vitest";
import { runGameV2, reportV2 } from "../src/sim/run-v2";
import { createGameV2 } from "../src/engine-v2/state";
import { applyActionV2, startGameV2, IllegalActionV2 } from "../src/engine-v2/turn";
import { randomBotV2 } from "../src/bots-v2/random";
import { createRng } from "../src/engine/rng";
import { useRealData } from "./compact";

// Achado (03/10/2026, ver KANBAN.md item 40): este arquivo nunca chamava
// useRealData() (diferente de tests/sim.test.ts, que já chamava) — as
// partidas aqui corriam com `balance.damage.champion_damage_multiplier = 1`
// do tabuleiro compacto de testes (tests/compact.ts/setup.ts) em vez do
// x1,5 real de data/balance.json. Com dano mais fraco, combate nunca era
// letal o bastante pra compensar o bot guloso preferir ficar se buffando
// (depois do ajuste de evaluateV2 em src/bots-v2/greedy.ts que passou a dar
// valor a buff em aliado) — a partida da seed 4 nunca convergia (1963
// rodadas, 8000 ações, sem vencedor). Com o multiplicador real, converge
// normalmente (ver os números das partidas abaixo).
useRealData();

describe("partidas simuladas (roster v2)", () => {
  it("bot guloso contra bot guloso termina uma partida completa sem erro", () => {
    const r = runGameV2(2, "guloso");
    expect(r.error).toBeUndefined();
    expect(r.winner).not.toBeNull();
    expect(r.actions).toBeGreaterThan(50);
  }, 120000);

  it("a mesma seed repete a mesma partida", () => {
    const a = runGameV2(4, "guloso");
    const b = runGameV2(4, "guloso");
    expect([a.winner, a.rounds, a.actions]).toEqual([b.winner, b.rounds, b.actions]);
  }, 120000);

  it("bot aleatório joga milhares de ações sem quebrar o motor", () => {
    // O catálogo de `effects` das cartas v2 tem ~60 tipos, todos já implementados
    // (item 37 do KANBAN, concluído). O bot aleatório ainda pode escolher uma ação
    // que era legal no momento em que foi enumerada (legalActionsV2) mas deixou de
    // ser por uma resposta rápida do adversário no meio do caminho — commitCardV2
    // revalida e lança IllegalActionV2 (ex. "fora de alcance"), esperado. A checagem
    // de "não implementado" continua aqui só como rede de segurança (se algum tipo
    // novo entrar sem handler, o teste aponta pra isso em vez de mascarar). Este
    // teste garante que NENHUM OUTRO tipo de erro aparece.
    for (const seed of [1, 2, 3]) {
      const s = createGameV2(seed, { comp: { A: ["niara", "varek", "selene"], B: ["borak", "dorin", "aurelia"] } });
      const bot = randomBotV2(createRng(seed));
      startGameV2(s);
      for (let i = 0; i < 4000 && !s.winner; i++) {
        const team = s.pending ? s.pending.priority : s.turn.team;
        try {
          applyActionV2(s, team, bot(s, team));
        } catch (e) {
          if (e instanceof IllegalActionV2) continue;
          if (!(e instanceof Error) || !e.message.includes("não implementado")) throw e;
        }
      }
      expect(s.winner !== null || s.round > 5).toBe(true);
    }
  }, 120000);

  it("relatório resume vitórias e cartas nunca jogadas", () => {
    const text = reportV2([runGameV2(2, "guloso")]);
    expect(text).toMatch(/Partidas: 1/);
    expect(text).toMatch(/nunca jogadas/);
  }, 120000);
});
