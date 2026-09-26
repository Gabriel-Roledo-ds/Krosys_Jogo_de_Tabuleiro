// Compara variações de balanceamento: npm run experiment
import { balance, bossDef } from "../engine/data";
import { runGame, report, type GameResult } from "./run";

const variants: Record<string, () => void> = {
  base: () => {},
  "boss 40 PV": () => { bossDef.hp = 40; },
  "boss 40 PV, mana +2": () => { bossDef.hp = 40; balance.mana.gain_per_turn = 2; },
  "boss 30 PV, mana +2": () => { bossDef.hp = 30; balance.mana.gain_per_turn = 2; },
};
const n = Number(process.argv[2] ?? 12);
const orig = { hp: bossDef.hp, mana: balance.mana.gain_per_turn };
for (const [name, apply] of Object.entries(variants)) {
  bossDef.hp = orig.hp;
  balance.mana.gain_per_turn = orig.mana;
  apply();
  const results: GameResult[] = [];
  for (let seed = 1; seed <= n; seed++) results.push(runGame(seed, "guloso"));
  const r = results.map((x) => x.rounds).sort((a, b) => a - b);
  const done = results.filter((x) => x.winner).length;
  const combo = results.filter((x) => x.winner === x.comboTeam).length;
  console.log(`${name}: terminaram ${done}/${n}, rodadas mediana ${r[Math.floor(r.length / 2)]} (mín ${r[0]}, máx ${r[r.length - 1]}), mortes ${(results.reduce((a, x) => a + x.deaths, 0) / n).toFixed(1)}, Combo ${combo}/${done}`);
}
void report;
