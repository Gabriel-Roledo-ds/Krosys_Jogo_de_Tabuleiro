import { createGame } from "../engine/state";
import { applyAction, startGame } from "../engine/turn";
import { randomBot } from "../bots/random";
import { createRng } from "../engine/rng";

const seeds = Number(process.argv[2] ?? 20);
let finished = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const s = createGame({ A: ["enredador", "piromante", "atirador"], B: ["arquiteto", "andarilho", "curandeiro"] }, seed);
  const bot = randomBot(createRng(seed * 7919));
  startGame(s);
  let steps = 0;
  try {
    while (!s.winner && steps < 20000) {
      const team = s.pending ? s.pending.priority : s.turn.team;
      applyAction(s, team, bot(s, team));
      steps++;
    }
  } catch (e) {
    console.log(`seed ${seed}: ERRO após ${steps} ações, rodada ${s.round}, fase ${s.turn.phase}:`, (e as Error).stack?.split("\n").slice(0, 6).join("\n"));
    process.exitCode = 1;
    break;
  }
  if (s.winner) finished++;
  console.log(`seed ${seed}: ${s.winner ? "vencedor " + s.winner : "sem fim"} em ${steps} ações, rodada ${s.round}, boss ${s.boss.hp}/${s.boss.maxHp}`);
}
console.log(`${finished}/${seeds} partidas terminaram`);
