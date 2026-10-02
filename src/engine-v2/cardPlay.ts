// Camada de "jogar uma carta" do motor hexagonal (roster v2) — item 4 da ordem
// de execução em KANBAN.md. Junta o que já existia solto: target+alcance da
// carta (targeting.ts) escolhe quem é afetado, o rank escolhido pelo jogador
// decide custo/alcance/efeitos, a mana é da equipe (mana.ts) e cada bloco de
// `effects` do rank roda em sequência sobre o MESMO EffectContextV2 (pra
// ricochete/encadeamento funcionar, ver effects.ts). Pilha de respostas
// rápidas, fase de turno (compra/movimento/básica) e boss ficam em turn.ts,
// que ainda não existe — playCardV2 só executa UMA carta já escolhida,
// testável isoladamente (como os testes de effects.ts já fazem à mão).
//
// Fora de escopo aqui (ver KANBAN.md pra cada um):
// - habilidades básicas: champions_v2.json não guarda um `target` pra elas
//   (só `range`+`effects`) — teria que ser inferido por herói/efeito, o que é
//   um achado de design em aberto, não resolvido por suposição silenciosa.
// - "wall"/"two_cells" com efeitos ainda não implementados (create_walls_line,
//   create_portal_pair) — a carta valida o alvo mas applyEffectV2 lança erro
//   claro ao tentar aplicar, igual qualquer outro tipo não implementado.
// - resurrect/death_ward (item 5) e tudo que depende de boss v2 (item 6).

import { rngOf } from "../engine/rng";
import type { Effect } from "../engine/data";
import { hexDirectionTo } from "../design/hexGrid";
import { applyEffectV2, type EffectContextV2 } from "./effects";
import { discardCardV2 } from "./deck";
import { canPayV2, spendManaV2 } from "./mana";
import { getCardDefV2, getCardRankV2, type CardDefV2, type CardRank } from "./data";
import { getChampionV2, logV2, nextIdV2, type ChampionStateV2, type GameStateV2, type TeamId } from "./state";
import { enemiesInRange, validateTargetV2, type TargetV2 } from "./targeting";

export class IllegalActionV2 extends Error {}

function fail(msg: string): never {
  throw new IllegalActionV2(msg);
}

/** `rank.range` vem como number | "self" | null (direction/line sem alcance numérico) — null é tratado como 0 pra validação, já que esses targets não checam alcance por casa (ex. "direction"). */
export function rankRangeV2(rank: CardRank): number | "self" {
  if (typeof rank.range === "number") return rank.range;
  if (rank.range === "self") return "self";
  return 0;
}

export interface TargetResolutionV2 {
  /** Alvos-campeão escolhidos pelo jogador, já validados — a entrada "padrão" de applyEffectV2 pra quem não tem resolução própria (around_self/random_targets/etc., tratados em effects.ts ou aqui mesmo). */
  targets: ChampionStateV2[];
  ctxExtra: Partial<EffectContextV2>;
}

/**
 * Resolve, a partir do `target` da carta e do que o jogador escolheu (`t`),
 * quem são os alvos-campeão e quais campos de EffectContextV2 preencher
 * (targetCell/moveDest/moveDir) — a peça que faltava pros `ctx.*` que
 * effects.ts hoje só documentava como "preenchido à mão até essa camada
 * existir".
 */
export function resolveCardTargetsV2(owner: ChampionStateV2, cardTarget: string, t: TargetV2, game: GameStateV2): TargetResolutionV2 {
  const ctxExtra: Partial<EffectContextV2> = {};
  let targets: ChampionStateV2[] = [];
  switch (cardTarget) {
    case "self":
      targets = [owner];
      break;
    case "cell":
      // Efeitos de alvo "cell" no catálogo atual agem sobre quem usou a carta
      // (move_self/teleport_self/create_wall/ground_fire/venom_zone) — nenhum
      // ainda escolhe outro campeão por uid numa casa.
      targets = [owner];
      if (t.pos) {
        ctxExtra.targetCell = t.pos;
        ctxExtra.moveDest = t.pos;
      }
      break;
    case "enemy":
    case "ally":
    case "champion":
    case "champion_in_line":
      if (t.uid) targets = [getChampionV2(game, t.uid)];
      break;
    case "random_enemies":
      // Sem alvo escolhido pelo jogador — cada bloco com `random_targets: N`
      // sorteia os próprios alvos (ver resolveEffectTargetsV2).
      targets = [];
      break;
    case "direction":
      if (t.dir) ctxExtra.moveDir = t.dir;
      break;
    case "line":
      if (t.pos) {
        ctxExtra.targetCell = t.pos;
        ctxExtra.moveDir = hexDirectionTo(owner.pos, t.pos);
      }
      break;
    case "wall":
      if (t.pos) ctxExtra.targetCell = t.pos;
      break;
    case "two_cells":
      // `create_portal_pair` (único consumidor hoje) ainda não está
      // implementado em effects.ts — guardamos só a primeira casa; a segunda
      // (`t.pos2`) não tem campo próprio em EffectContextV2 ainda (gap
      // documentado em KANBAN.md, resolver junto quando portais entrarem).
      if (t.pos) ctxExtra.targetCell = t.pos;
      break;
    default:
      break;
  }
  return { targets, ctxExtra };
}

/** Alvos reais de UM bloco de efeito: a maioria usa os alvos da carta; `random_targets` sorteia os seus próprios dentro do alcance do rank. */
function resolveEffectTargetsV2(game: GameStateV2, owner: ChampionStateV2, effect: Effect, baseTargets: ChampionStateV2[], rank: CardRank): ChampionStateV2[] {
  if (typeof effect.random_targets === "number") {
    const pool = enemiesInRange(game, owner, { range: rankRangeV2(rank), target: "enemy" });
    return rngOf(game).shuffle(pool).slice(0, effect.random_targets);
  }
  return baseTargets;
}

export interface PlayCardResultV2 {
  owner: ChampionStateV2;
  card: CardDefV2;
  rank: CardRank;
}

/**
 * Executa uma carta já escolhida pelo jogador (carta + rank + alvo): valida
 * o alvo contra o alcance do rank, cobra a mana de equipe, consome e limpa o
 * bônus de `buff_next_card` (Passo das Sombras da Vextra) se a própria carta
 * não renová-lo, roda cada bloco de `rank.effects` em sequência sobre o
 * mesmo contexto e descarta a carta pro baralho do dono. Lança
 * `IllegalActionV2` se algo for inválido (carta fora da mão, alvo inválido,
 * mana insuficiente, dono fora de campo).
 */
export function playCardV2(game: GameStateV2, team: TeamId, cardUid: string, rankNumber: number, t: TargetV2): PlayCardResultV2 {
  const hand = game.teams[team].hand;
  const cardInstance = hand.find((c) => c.uid === cardUid);
  if (!cardInstance) fail("Carta não está na mão");
  const owner = getChampionV2(game, cardInstance.owner);
  if (!owner.alive) fail("O dono da carta não está em campo");
  const def = getCardDefV2(cardInstance.cardId);
  const rank = getCardRankV2(def, rankNumber);

  const err = validateTargetV2(game, owner, { range: rankRangeV2(rank), target: def.target }, t);
  if (err) fail(err);
  if (!canPayV2(game, team, rank.cost)) fail("Mana insuficiente");

  const buff = game.teams[team].nextCardBuff ?? undefined;

  spendManaV2(game, team, rank.cost);
  game.teams[team].hand = hand.filter((c) => c.uid !== cardUid);
  discardCardV2(game, cardInstance);
  if (buff && !rank.effects.some((e) => e.type === "buff_next_card")) game.teams[team].nextCardBuff = null;

  const { targets, ctxExtra } = resolveCardTargetsV2(owner, def.target, t, game);
  const ctx: EffectContextV2 = {
    game,
    attacker: owner,
    nextId: () => nextIdV2(game),
    bonusDamage: buff?.bonusDamage,
    ...ctxExtra,
  };

  for (const effect of rank.effects) {
    const effectTargets = resolveEffectTargetsV2(game, owner, effect, targets, rank);
    applyEffectV2(ctx, effect, effectTargets);
  }

  logV2(game, `${owner.defId} (${team}) usa ${def.name} (rank ${rankNumber})`);
  return { owner, card: def, rank };
}
