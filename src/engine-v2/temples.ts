// Templos de bênção nos cantos obtusos do mapa hexagonal (roster v2) — item 43
// do KANBAN, regras-e-decisoes.md §21. Cada um dos 2 cantos reservados em
// data/hex_board.json#corner_pockets guarda um templo com um guardião único
// e forte (data/temples.json#guardian). Quem derrotar o guardião reivindica o
// templo pra sua equipe e ganha, PRA SEMPRE, o deus FIXO daquele canto.
//
// Decisão de design [PADRÃO, 03/10/2026] — simplificação deliberada do "o
// jogador escolhe um deus pra abençoar o time" da ideia original (sem
// mecânica especificada até aqui, só o espaço reservado no mapa): em vez de
// uma escolha em tempo real (que exigiria uma camada nova de ação pendente —
// pending/stack próprio, tipo de ActionV2 novo, UI de escolha, bot sabendo
// escolher — bem mais código pra uma decisão que, na prática, os dois
// templos já cobrem com só 2 opções), cada CANTO carrega um deus fixo desde
// o início da partida (visível em board/temples da view, sem segredo). Isso
// mantém a mesma convenção já usada pela recompensa de monstro do mapa
// (claude/monstros-mapa.md: carta "ativa" OU bônus permanente, decidido pelo
// TIPO do monstro, nunca por escolha do jogador no momento do abate) — ver
// monsters.ts, applyMonsterRewardV2. Uma escolha de verdade (ex. qual dos 2
// templos ainda não reivindicados perseguir) continua existindo no nível
// estratégico (pra qual canto mandar a equipe), só não no momento do abate.
//
// O efeito da bênção reaproveita 100% a máquina de status já existente
// (damage_buff/heal_over_time — ver status.ts/damage.ts/tick.ts), só com um
// novo campo `permanent: true` em StatusV2 que faz tick.ts pular o
// decremento/remoção por rodada (ver cabeçalho de tick.ts) — nenhuma conta
// nova de dano/cura precisou ser escrita. Aplicado a TODOS os 3 campeões da
// equipe (vivos ou não no momento do abate): como o objeto do campeão
// persiste entre morte/retorno (nunca é recriado), a bênção continua valendo
// depois de qualquer morte futura, sem precisar reaplicar nada.

import { balance } from "../engine/data";
import templesDef from "./temples-data";
import { addStatus } from "./status";
import { logV2, type ChampionStateV2, type GameStateV2, type TeamId, type TempleStateV2 } from "./state";

/** uid dos templos segue o padrão "temple-<nome do canto>" (ver state.ts, buildTemplesV2). */
export const isTempleUidV2 = (uid?: string): boolean => !!uid && uid.startsWith("temple-");

export function findTempleV2(s: GameStateV2, uid: string): TempleStateV2 {
  const t = s.temples.find((x) => x.uid === uid);
  if (!t) throw new Error(`Templo inexistente: ${uid}`);
  return t;
}

const roundMultiplied = (x: number): number => Math.floor(x + 0.5 + 1e-9);

/**
 * Dano de um campeão num guardião de templo (cartas/básicas de alvo único
 * "enemy" apontadas pro uid do templo — mesmo padrão de attackBossV2/
 * attackMonsterV2). Se o guardião SOBREVIVER ao golpe, contra-ataca na hora
 * (ignora defesa — "forte demais pra enfrentar sozinho", ver regras-e-decisoes.md
 * §21); um golpe que mata o guardião não sofre contra-ataque (ele já caiu).
 * Se o guardião morrer, reivindica o templo pra equipe de `attacker` (ver
 * claimTempleV2).
 */
export function attackTempleV2(
  game: GameStateV2,
  attacker: ChampionStateV2,
  temple: TempleStateV2,
  base: number,
  opts: { ignoreDefense?: boolean } = {},
): number {
  if (!temple.alive || base <= 0) return 0;

  let mult = balance.damage.champion_damage_multiplier ?? 1;
  if (attacker.permanentDamageBonusPercent) mult *= 1 + attacker.permanentDamageBonusPercent / 100;
  let total = mult !== 1 ? roundMultiplied(base * mult) : base;

  if (!opts.ignoreDefense) total -= temple.defense;
  total = Math.max(balance.damage.minimum_damage_if_base_at_least_1, total);
  const final = Math.max(0, total);
  if (final <= 0) return 0;

  temple.hp -= final;
  logV2(game, `Guardião de ${temple.name} sofre ${final} de dano de ${attacker.defId} (${Math.max(0, temple.hp)}/${temple.maxHp} PV)`);

  if (temple.hp <= 0) {
    claimTempleV2(game, temple, attacker.team);
  } else if (temple.counterDamage > 0) {
    // Ignora a defesa do campeão de propósito (ver cabeçalho do arquivo e
    // data/temples.json): o guardião é "forte demais pra enfrentar sozinho"
    // mesmo contra um campeão bem defendido.
    const counter = temple.counterDamage;
    attacker.hp -= counter;
    logV2(game, `Guardião de ${temple.name} contra-ataca ${attacker.defId} (${attacker.team}) por ${counter} (${Math.max(0, attacker.hp)}/${attacker.maxHp} PV)`);
  }
  return final;
}

/** Guardião derrotado: reivindica o templo pra `team` e concede o deus fixo daquele canto a toda a equipe (ver cabeçalho do arquivo). */
function claimTempleV2(game: GameStateV2, temple: TempleStateV2, team: TeamId): void {
  temple.alive = false;
  temple.claimedBy = team;
  const god = templesDef.gods_by_corner[temple.name];
  const t = game.teams[team];
  t.blessings.push(god.id);
  for (const c of t.champions) {
    addStatus(c, game.nextId++, god.status, "rounds", 1, { amount: god.amount, permanent: true });
  }
  logV2(game, `Equipe ${team} derrota o guardião de ${temple.name} e reivindica a bênção de ${god.name}!`);
}
