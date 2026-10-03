// Sacrifícios de passiva (roster v2) — 9 regras bespoke por campeão, uma por
// campeão com `sacrifice !== null` em data/champions_v2.json (catalogadas em
// SacrificeDefV2, data.ts). Cada uma abre mão de um recurso do PRÓPRIO turno
// (compra, básica, movimento ou alguns pontos de vida) pra ganhar um bônus
// específico — ver regras-e-decisoes.md §22 pro design completo.
//
// [PADRÃO] Granularidade de duração: todo bônus temporário concedido aqui usa
// status com unit "rounds", duration 1 (removido no próximo tickRoundV2, ver
// tick.ts) — a mesma granularidade já usada pela bênção de templo (§21) antes
// de virar permanente. Isso cobre "o resto deste turno" com folga, mas também
// deixa o bônus tecnicamente ativo durante o turno INTEIRO do adversário
// seguinte (até o próximo tickRoundV2) — relevante só se o campeão jogar uma
// carta RÁPIDA nesse meio-tempo, caso raro e de impacto pequeno. Usar
// "champion_turns" exigiria contar quem "ativou" neste turno (ver
// expireChampionTurnStatuses em tick.ts), que não cobre sacrifícios que não
// envolvem movimento (Ignira/Dorin abrem mão da compra, não se movem) — fica
// documentado como simplificação deliberada, não um bug escondido.
//
// Reaproveita `ChampionStateV2.sacrificeUsedThisTurn` (campo já existia em
// state.ts, nunca lido/escrito antes desta etapa) como a guarda de "só 1x por
// turno" — resetado em `finishTurn` (turn.ts), junto do `untargetable`.

import { getChampionDefV2 } from "./data";
import { addStatus } from "./status";
import { allChampionsV2, getChampionV2, logV2, nextIdV2, type ChampionStateV2, type GameStateV2, type TeamId } from "./state";

/** Fases em que CADA sacrifício pode ser declarado — a maioria na fase de ação, mas Ignira e Dorin abrem mão da COMPRA, então só fazem sentido na fase "draw" (antes de comprar). */
const DRAW_PHASE_SACRIFICES = new Set(["ignira", "dorin"]);

/** `true` se o sacrifício desse campeão (abre mão da compra) precisa ser declarado na fase "draw" — usado por turn.ts pra decidir se precisa repetir a transição de fase/dado/mana do "skipDraw" depois de aplicar. */
export function sacrificeSkipsDrawV2(defId: string): boolean {
  return DRAW_PHASE_SACRIFICES.has(defId);
}

function fail(msg: string): string {
  return msg;
}

/**
 * Valida se `championUid` (da equipe `team`) pode declarar o sacrifício da
 * própria passiva agora. Devolve o motivo (string) se não puder, ou `null` se
 * puder. `target` só é usado (e exigido) pelo sacrifício do Varek (escolhe o
 * aliado a proteger).
 */
export function canSacrificeV2(game: GameStateV2, team: TeamId, championUid: string, target?: string): string | null {
  const t = game.turn;
  if (game.pending) return fail("não dá para sacrificar durante uma resposta");
  if (t.team !== team) return fail("não é o turno dessa equipe");
  let c: ChampionStateV2;
  try {
    c = getChampionV2(game, championUid);
  } catch {
    return fail("campeão inexistente");
  }
  if (c.team !== team) return fail("campeão não é dessa equipe");
  if (!c.alive) return fail("campeão não está em campo");
  const def = getChampionDefV2(c.defId);
  if (!def.sacrifice) return fail("esse campeão não tem sacrifício de passiva");
  if (c.sacrificeUsedThisTurn) return fail("sacrifício já usado neste turno");

  const wantsDrawPhase = DRAW_PHASE_SACRIFICES.has(c.defId);
  if (wantsDrawPhase && t.phase !== "draw") return fail("esse sacrifício só pode ser declarado na fase de compra");
  if (!wantsDrawPhase && t.phase !== "act") return fail("esse sacrifício só pode ser declarado na fase de ação");

  switch (c.defId) {
    case "borak":
      if (c.hp < 5) return fail("precisa de pelo menos 5 de vida (perde 4)");
      return null;
    case "selene":
      if (c.hp < 4) return fail("precisa de pelo menos 4 de vida (perde 3)");
      return null;
    case "varek": {
      if (t.activated.includes(c.uid)) return fail("já gastou o movimento neste turno");
      if (!target) return fail("escolha o aliado a proteger");
      let ally: ChampionStateV2;
      try {
        ally = getChampionV2(game, target);
      } catch {
        return fail("aliado inválido");
      }
      if (ally.team !== team) return fail("só pode proteger um aliado");
      if (ally.uid === c.uid) return fail("não pode proteger a si mesmo");
      if (!ally.alive) return fail("aliado não está em campo");
      return null;
    }
    case "sylvane":
      if (t.basicUsed.includes(c.uid)) return fail("já usou a básica neste turno");
      return null;
    case "aurelia":
      if (t.basicUsed.includes(c.uid)) return fail("já usou a básica neste turno");
      if (t.activated.includes(c.uid)) return fail("já gastou o movimento neste turno");
      return null;
    case "vextra":
      if (t.basicUsed.includes(c.uid)) return fail("já usou a básica neste turno");
      if (t.activated.includes(c.uid)) return fail("já gastou o movimento neste turno");
      return null;
    default:
      // ignira, dorin, thorne: sem precondição além da fase/uso único já checados acima.
      return null;
  }
}

/**
 * Aplica o sacrifício da passiva de `championUid` — já validado por
 * `canSacrificeV2`, chamado de novo aqui por segurança (lança se inválido).
 * Marca `sacrificeUsedThisTurn` e loga, independente do campeão.
 */
export function applySacrificeV2(game: GameStateV2, team: TeamId, championUid: string, target?: string): void {
  const err = canSacrificeV2(game, team, championUid, target);
  if (err) throw new Error(err);
  const c = getChampionV2(game, championUid);
  const def = getChampionDefV2(c.defId);
  const t = game.turn;
  c.sacrificeUsedThisTurn = true;

  const grant = (status: string, amount?: number) => addStatus(c, nextIdV2(game), status, "rounds", 1, { amount, negative: false });
  const markActivatedNoMove = () => {
    if (!t.activated.includes(c.uid)) t.activated.push(c.uid);
  };
  const markBasicUsed = () => {
    if (!t.basicUsed.includes(c.uid)) t.basicUsed.push(c.uid);
  };

  switch (c.defId) {
    case "borak":
      // Fúria Desenfreada: perde 4 de vida (já confirmado hp>=5 em canSacrificeV2,
      // então nunca zera) e ganha +3 de dano fixo em toda carta/básica do turno
      // (ver cardPlay.ts, playCardV2/playBasicV2 somando sacrifice_bonus_damage
      // ao bonusDamage de sempre).
      c.hp -= 4;
      grant("sacrifice_bonus_damage", 3);
      break;
    case "ignira":
      // Fogo Selvagem: abre mão da compra (a transição de fase/dado/mana é
      // feita por turn.ts, ver sacrificeSkipsDrawV2) e dá +1 de raio/+1
      // rodada de duração ao chão em chamas criado no turno (ver effects.ts
      // applyGroundFire).
      grant("sacrifice_fogo_selvagem");
      break;
    case "vextra": {
      // Em Sombras: abre mão de toda ação do turno (move/básica/cartas — essa
      // última via o novo status "sacrificed_inactive", ver cannotCastV2 em
      // turn.ts) pra ficar invisível (status "stealthed", ver targeting.ts
      // enemyAt/enemiesInRange) até o início do próprio próximo turno, e
      // garante bônus de dano no primeiro golpe depois (consumido em
      // effects.ts applyDamage).
      markActivatedNoMove();
      markBasicUsed();
      grant("sacrificed_inactive");
      grant("stealthed");
      grant("sacrifice_backstab_next_hit", 4);
      break;
    }
    case "thorne":
      // Toxina Concentrada: abre mão de 2 casas de alcance em toda carta do
      // turno (ver cardPlay.ts, rangeBonus negativo em playCardV2) e cada
      // acerto de veneno aplica 2 estacas em vez de 1 (ver effects.ts
      // applyVenomStacks, ctx.bonusVenomStacks).
      grant("sacrifice_range_penalty", 2);
      grant("sacrifice_venom_bonus", 1);
      break;
    case "selene":
      // Prece Desesperada: perde 3 de vida própria (hp>=4 confirmado) pra
      // dobrar a PRÓXIMA cura direta do turno (consumido em effects.ts applyHeal).
      c.hp -= 3;
      grant("sacrifice_double_heal");
      break;
    case "varek": {
      // Último Bastião: abre mão de toda movimentação (nunca fica "main" nem
      // ganha orçamento de movimento este turno) pra redirecionar pra si todo
      // dano que o aliado escolhido sofreria, até o início do próprio próximo
      // turno (ver ChampionStateV2.protectedBy, consumido em damage.ts
      // dealDamageV2 e limpo em tick.ts tickRoundV2).
      markActivatedNoMove();
      const ally = getChampionV2(game, target!);
      ally.protectedBy = c;
      logV2(game, `${c.defId} (${c.team}) sacrifica o movimento pra proteger ${ally.defId}`);
      break;
    }
    case "sylvane":
      // Floresta Desperta: abre mão da básica pra dar +1 casa de raio às
      // cartas de CONTROLE em área do turno (ver cardPlay.ts
      // resolveEffectTargetsV2, ctx.bonusAreaRadius só quando o status é de
      // controle — stun/root/silenced/movement_reduced/taunted).
      markBasicUsed();
      grant("sacrifice_control_radius_bonus", 1);
      break;
    case "dorin":
      // Construção Acelerada: abre mão da compra (transição feita por
      // turn.ts, ver sacrificeSkipsDrawV2) pra dobrar a quantidade de
      // paredes/estruturas criadas pelas cartas do turno (contagem dobrada
      // pros efeitos com `count`; hp dobrado pros de placement único — ver
      // effects.ts applyCreateStructure/applyCreateWall/applyCreateWallsLine/
      // applyCreateWallsShape/applyCreateWallsAroundTarget).
      grant("sacrifice_double_construct");
      break;
    case "aurelia":
      // Canalização Total: abre mão da básica E de toda movimentação pra
      // fazer os BUFFS (status não-negativo) aplicados no turno durarem +1
      // rodada e valerem +50% (ver effects.ts applyStatus/applyLinkBuff,
      // ctx.bonusBuffMagnitudePercent/bonusBuffDurationRounds).
      markBasicUsed();
      markActivatedNoMove();
      grant("sacrifice_buff_boost");
      break;
    default:
      throw new Error(`Sacrifício de passiva não implementado pra ${c.defId}`);
  }

  logV2(game, `${c.defId} (${c.team}) sacrifica a passiva: ${def.sacrifice!.name}`);
}

/** Alvos válidos pro sacrifício do Varek (aliados vivos, exceto ele mesmo) — usado por legalActionsV2 (turn.ts). */
export function sacrificeAllyTargetsV2(game: GameStateV2, championUid: string): string[] {
  const c = getChampionV2(game, championUid);
  return allChampionsV2(game)
    .filter((a) => a.alive && a.team === c.team && a.uid !== c.uid)
    .map((a) => a.uid);
}
