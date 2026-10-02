// Monstros do mapa no motor hexagonal (roster v2) — item 7 da ordem de execução
// (KANBAN.md). Design em claude/monstros-mapa.md (Project): 40 criaturas (20 por
// zona) fora o boss, cada uma com reação ao ataque (auto/choice/mini_turn,
// decidida por postura — src/design/monsterReaction.ts, não tocado aqui) e
// recompensa pessoal (carta ativa e/ou bônus permanente) pra quem der o
// último golpe.
//
// Escopo desta etapa (o que FICA de fora, documentado em vez de ignorado):
// - Reação: só os tipos de efeito damage/reflect_damage/push/apply_status
//   (quando alvo é o próprio atacante)/heal (quando alvo é a própria criatura)
//   são aplicados. `move_self_away_from_target`, `create_wall`, `summon_minion`
//   e `apply_status` com alvo a própria criatura (Casca Dura/Núcleo de Ferro)
//   são logados e ignorados — reações disparam toda hora (ataque automático),
//   então travar nesses casos seria pior do que uma lacuna documentada (ver
//   cartas/efeitos de jogador, que travam alto porque são escolha explícita).
// - `targets`/`require_adjacent_to_each_other`/`radius` em efeitos de dano de
//   reação (Salto Duplo, Erupção) são ignorados — dano de reação sempre acerta
//   só quem atacou, não múltiplos alvos.
// - O campo `condition` de uma opção de reação (ex. "attacker_did_not_move_this_turn"
//   do Texugo, "first_attack_received_this_combat" da Gárgula) NÃO é avaliado —
//   a opção escolhida por chooseReactionOption (postura) sempre executa. O
//   próprio monsterReaction.ts (não alterado aqui) já não avalia `condition`.
// - Mini-turno (`reaction.kind === "mini_turn"`): só a habilidade é aplicada, o
//   movimento da criatura (`reaction.move`) não é simulado ainda.
// - canFlee (postura evasiva) é sempre considerado `true` (sem detecção de
//   "encurralada contra parede/borda") — gap documentado, calibrar quando o
//   posicionamento de monstros estiver testado em jogo real.
//
// ACHADO DE DADO CORRIGIDO (02/10/2026): em data/monsters_map.json,
// basilisco_pedra (postura "agressiva") tinha as opções na ordem ['Olhar
// Petrificante' (controle, sem dano), 'Mordida Pétrea' (dano)], ao contrário
// da convenção documentada em monsterReaction.ts ("a 1ª opção listada é a de
// dano/agressiva") — um basilisco agressivo reagia com controle, não dano.
// Ordem invertida nos dados (Mordida Pétrea primeiro); ver
// tests/engine-v2-monsters.test.ts.

import { balance } from "../engine/data";
import {
  decideReaction,
  getMonsterType,
  type CombatContext,
  type ReactionOption,
} from "../design/monsterReaction";
import { getCardDefV2 } from "./data";
import { pushChampion } from "./movement";
import { addStatus } from "./status";
import { logV2, type ChampionStateV2, type GameStateV2, type MonsterStateV2 } from "./state";

const roundMultiplied = (x: number): number => Math.floor(x + 0.5 + 1e-9);

/** uid dos monstros do mapa segue o padrão "monster-<índice>" (ver state.ts, createGameV2). */
export const isMonsterUidV2 = (uid?: string): boolean => !!uid && uid.startsWith("monster-");

export function findMonsterV2(s: GameStateV2, uid: string): MonsterStateV2 {
  const m = s.monsters.find((x) => x.uid === uid);
  if (!m) throw new Error(`Monstro inexistente: ${uid}`);
  return m;
}

/**
 * Curvas de retorno decrescente (claude/monstros-mapa.md, "Curvas de retorno
 * decrescente") — não acumula versão por versão, SOMA O VALOR DA TABELA pro
 * número de abates do grupo (zona:nível:stat:curva), recalculado do zero a
 * cada abate (ver recomputeChampionBonusesV2). Índice = abates - 1, capado no
 * teto (5+).
 */
const CURVE_TABLE: Record<string, number[]> = {
  "full:damage": [8, 14, 19, 23, 25],
  "full:defense": [1, 2, 2, 3, 3],
  "full:max_hp": [10, 18, 24, 28, 30],
  "reduced:damage": [4, 7, 10, 12, 13],
};

function curveValue(stat: string, curve: string, kills: number): number {
  const table = CURVE_TABLE[`${curve}:${stat}`];
  if (!table || kills <= 0) return 0;
  const idx = Math.min(kills, table.length) - 1;
  return table[idx];
}

/**
 * Recalcula os três bônus permanentes de monstro de um campeão (% de dano,
 * defesa fixa, % de vida máxima) a partir de TODOS os grupos já abatidos —
 * nunca soma incremental, sempre reconstrói do zero (regra "não acumula, só
 * a versão mais alta conta" aplicada por grupo, e os grupos entre si somam).
 * Ajusta hp atual proporcionalmente quando a vida máxima muda.
 */
export function recomputeChampionBonusesV2(champion: ChampionStateV2): void {
  let damagePercent = 0;
  let defenseFlat = 0;
  let maxHpPercent = 0;
  for (const [key, kills] of Object.entries(champion.monsterStatGroups)) {
    const parts = key.split(":");
    const stat = parts[2];
    const curve = parts[3];
    const value = curveValue(stat, curve, kills);
    if (stat === "damage") damagePercent += value;
    else if (stat === "defense") defenseFlat += value;
    else if (stat === "max_hp") maxHpPercent += value;
  }
  champion.permanentDamageBonusPercent = damagePercent;
  champion.defense = champion.baseDefense + defenseFlat;
  const newMaxHp = Math.round(champion.baseMaxHp * (1 + maxHpPercent / 100));
  const delta = newMaxHp - champion.maxHp;
  champion.maxHp = newMaxHp;
  champion.hp = Math.min(champion.maxHp, Math.max(0, champion.hp + delta));
}

/** Dano simples de uma reação de monstro num campeão: base - defesa (ou ignorando-a), mínimo 1. */
function dealMonsterDamageToChampionV2(
  game: GameStateV2,
  monster: MonsterStateV2,
  target: ChampionStateV2,
  base: number,
  opts: { ignoreDefense?: boolean } = {},
): void {
  let total = base;
  if (!opts.ignoreDefense) total -= target.defense;
  total = Math.max(balance.damage.minimum_damage_if_base_at_least_1, total);
  const final = Math.max(0, total);
  if (final <= 0) return;
  target.hp -= final;
  logV2(game, `${target.defId} (${target.team}) sofre ${final} de dano de ${monster.typeId} (${Math.max(0, target.hp)}/${target.maxHp} PV)`);
}

/** Aplica os efeitos de UMA opção de reação já escolhida (ver cabeçalho pros tipos ignorados). */
function applyReactionOptionV2(game: GameStateV2, monster: MonsterStateV2, attacker: ChampionStateV2, option: ReactionOption): void {
  const isSelfOption = option.range === "self";
  for (const e of option.effects) {
    const effect = e as { type: string; target?: string; [key: string]: unknown };
    switch (effect.type) {
      case "damage": {
        const ignoresDefense = effect.ignores_defense === true || (typeof effect.ignores_defense === "number" && effect.ignores_defense > 0);
        dealMonsterDamageToChampionV2(game, monster, attacker, Number(effect.amount ?? 0), { ignoreDefense: ignoresDefense });
        break;
      }
      case "reflect_damage":
        dealMonsterDamageToChampionV2(game, monster, attacker, Number(effect.amount ?? 0), { ignoreDefense: true });
        break;
      case "push":
        pushChampion(game, attacker, monster.pos, Number(effect.distance ?? 0));
        break;
      case "apply_status": {
        if (effect.target !== "attacker" && isSelfOption) {
          // Autobuff da própria criatura (Casca Dura/Núcleo de Ferro) — monstro
          // não tem array de status no motor ainda, fora de escopo desta etapa.
          logV2(game, `${monster.typeId}: autobuff de reação não implementado no motor v2 (${effect.status})`);
          break;
        }
        addStatus(
          attacker,
          game.nextId++,
          String(effect.status),
          (effect.duration as { unit: "rounds" | "champion_turns"; value: number }).unit,
          (effect.duration as { unit: "rounds" | "champion_turns"; value: number }).value,
          { amount: effect.amount as number | undefined, negative: true },
        );
        logV2(game, `${attacker.defId} (${attacker.team}) recebe ${effect.status} de ${monster.typeId}`);
        break;
      }
      case "heal":
        if (effect.target === "self") {
          const before = monster.hp;
          monster.hp = Math.min(monster.maxHp, monster.hp + Number(effect.amount ?? 0));
          logV2(game, `${monster.typeId} recupera ${monster.hp - before} PV (${monster.hp}/${monster.maxHp})`);
        } else {
          logV2(game, `${monster.typeId}: efeito heal sem alvo "self" não implementado no motor v2`);
        }
        break;
      case "move_self_away_from_target":
      case "create_wall":
      case "summon_minion":
        logV2(game, `${monster.typeId}: efeito de reação "${effect.type}" não implementado no motor v2 (ignorado)`);
        break;
      default:
        logV2(game, `${monster.typeId}: efeito de reação desconhecido "${effect.type}" (ignorado)`);
    }
  }
}

/**
 * Reação de um monstro vivo ao ser atacado por `attacker` — sempre dispara
 * (o único gatilho usado no motor é "attacked_by_champion", chamado só a
 * partir de attackMonsterV2, nunca por entrar no alcance/passar perto, ver
 * claude/monstros-mapa.md "Gatilho"). Resolve ANTES do dano do atacante
 * aplicar, como uma resposta rápida da criatura.
 */
export function reactMonsterV2(game: GameStateV2, monster: MonsterStateV2, attacker: ChampionStateV2): void {
  if (!monster.alive) return;
  const type = getMonsterType(monster.typeId);
  const ctx: CombatContext = {
    trigger: "attacked_by_champion",
    attackedBeforeThisCombat: monster.attackedBeforeThisCombat,
    fledOnceThisCombat: monster.fledOnceThisCombat,
    canFlee: true,
  };
  const decision = decideReaction(type, "attacked_by_champion", ctx);
  if (!decision.reacted) return;

  const { options } = type.reaction;
  const isUtilityChoice = options.length > 1 && decision.option === options[1];
  if (type.posture === "evasiva" && isUtilityChoice) monster.fledOnceThisCombat = true;

  applyReactionOptionV2(game, monster, attacker, decision.option);

  if (decision.option.posture_after) monster.posture = decision.option.posture_after;
  monster.attackedBeforeThisCombat = true;
}

/**
 * Dano de um campeão num monstro (cartas/básicas de alvo único "enemy"
 * apontadas pro uid do monstro — mesmo padrão de attackBossV2 em boss.ts, sem
 * o multiplicador de recompensa do boss). Dispara a reação da criatura ANTES
 * de aplicar o dano (ver reactMonsterV2). Se o monstro morrer, concede a
 * recompensa a `attacker` (ver killMonsterV2).
 */
export function attackMonsterV2(
  game: GameStateV2,
  attacker: ChampionStateV2,
  monster: MonsterStateV2,
  base: number,
  opts: { ignoreDefense?: boolean } = {},
): number {
  if (!monster.alive || base <= 0) return 0;

  reactMonsterV2(game, monster, attacker);

  let mult = balance.damage.champion_damage_multiplier ?? 1;
  if (attacker.permanentDamageBonusPercent) mult *= 1 + attacker.permanentDamageBonusPercent / 100;
  let total = mult !== 1 ? roundMultiplied(base * mult) : base;

  if (!opts.ignoreDefense) total -= monster.defense;
  total = Math.max(balance.damage.minimum_damage_if_base_at_least_1, total);
  const final = Math.max(0, total);
  if (final <= 0) return 0;

  monster.hp -= final;
  monster.lastAttacker = { team: attacker.team, champion: attacker.uid };
  logV2(game, `${monster.typeId} sofre ${final} de dano de ${attacker.defId} (${Math.max(0, monster.hp)}/${monster.maxHp} PV)`);

  if (monster.hp <= 0) killMonsterV2(game, monster, attacker);
  return final;
}

/** Concede a recompensa (carta e/ou bônus permanente) de um tipo de monstro a `champion`. */
function applyMonsterRewardV2(game: GameStateV2, champion: ChampionStateV2, monster: MonsterStateV2, reward: MonsterRewardV2 | null): void {
  if (!reward) return;
  if (reward.type === "card") {
    const def = getCardDefV2(reward.card_id!);
    const team = game.teams[champion.team];
    team.hand.push({ uid: `monster-reward-${game.nextId++}#${reward.card_id}`, cardId: reward.card_id!, owner: champion.uid, monster: true });
    logV2(game, `${champion.defId} (${champion.team}) recebe a carta "${def.name}" (recompensa de monstro)`);
  } else if (reward.type === "stat_permanent") {
    const key = `${monster.zone}:${monster.level}:${reward.stat}:${reward.curve}`;
    champion.monsterStatGroups[key] = (champion.monsterStatGroups[key] ?? 0) + 1;
    recomputeChampionBonusesV2(champion);
    logV2(game, `${champion.defId} (${champion.team}) ganha bônus permanente de ${reward.stat} (grupo ${key}, abate nº${champion.monsterStatGroups[key]})`);
  } else {
    logV2(game, `Tipo de recompensa de monstro não implementado no motor v2: ${reward.type}`);
  }
}

/** MonsterType (monsterReaction.ts) não declara reward_primary/secondary no tipo — eles existem nos dados (monsters_map.json#types) mas o campo é lido aqui via cast, já que esse arquivo de design não deveria importar conceitos de recompensa (fora do escopo dele). */
interface MonsterRewardV2 {
  type: string;
  card_id?: string;
  stat?: string;
  curve?: string;
}

/** Monstro derrotado: marca morto e concede a(s) recompensa(s) — ver claude/monstros-mapa.md ("recompensa pessoal, não de equipe"). */
function killMonsterV2(game: GameStateV2, monster: MonsterStateV2, killer: ChampionStateV2): void {
  monster.alive = false;
  logV2(game, `${monster.typeId} (zona ${monster.zone}) é derrotado por ${killer.defId} (${killer.team})`);
  const type = getMonsterType(monster.typeId) as unknown as { reward_primary?: MonsterRewardV2 | null; reward_secondary?: MonsterRewardV2 | null };
  applyMonsterRewardV2(game, killer, monster, type.reward_primary ?? null);
  applyMonsterRewardV2(game, killer, monster, type.reward_secondary ?? null);
}
