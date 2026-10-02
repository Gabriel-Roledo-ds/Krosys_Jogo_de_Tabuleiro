# Checkpoint — Krósys, motor hexagonal (roster v2)

Gerado em 02/10/2026, ao encerrar esta sessão por limite de tokens. Resume onde o
trabalho parou e exatamente o que fazer a seguir, pra qualquer sessão futura (Claude
ou humana) continuar sem precisar reconstruir o contexto do zero.

## Estado do jogo

- **O jogo em produção continua sendo o MVP** (6 campeões, tabuleiro 21x21 em losango,
  `src/engine/`). Ele não foi tocado nesta sessão e continua jogável via servidor +
  cliente Phaser existentes.
- **O motor hexagonal novo (`src/engine-v2/`, roster v2 — 10 campeões, 120 cartas,
  tabuleiro hex)** avançou bastante mas **ainda não é jogável de ponta a ponta**: não
  tem bots, servidor nem cliente ligados a ele. É só o motor (regras + testes).
- **462 testes passando no projeto inteiro**, `npx tsc --noEmit` limpo. Todo
  commit desta sessão seguiu o fluxo: código → teste → `tsc --noEmit` → `vitest run`
  completo → atualizar `KANBAN.md` → commit com mensagem descritiva → push.
- Repositório: `https://github.com/Gabriel-Roledo-ds/Krosys_Jogo_de_Tabuleiro.git`
  (branch `main`, já com todos os commits desta sessão enviados).

## O que foi feito nesta sessão (ordem cronológica)

Seguindo a ordem de execução definida no próprio `KANBAN.md` ("estabeleça a melhor
ordem e prossiga"):

1. ~~Morte e retorno de campeão~~ — já estava feito antes desta sessão.
2. ~~Paredes~~ (criar/reforçar/destruir, bloqueio de movimento e alcance) — já
   estava feito antes desta sessão.
3. **Efeitos de combate "simples" que reaproveitam dano/movimento em linha** —
   `move_in_line`, `damage_first_in_path`, `damage_pierce_line`,
   `damage_behind_target`, `damage_second_target`/`damage_third_target` (ricochete
   da Niara, com um bug de cadeia corrigido via `ctx.hitChain`), `gap_close_strike`,
   `buff_next_card`. Arquivo: `src/engine-v2/effects.ts` +
   `tests/engine-v2-effects-5.test.ts`.
4. **Camada de "jogar uma carta"/habilidade básica + turno completo** — a peça
   maior da sessão:
   - `src/engine-v2/cardPlay.ts`: `playCardV2`/`playBasicV2` (resolução imediata,
     útil pra testar isolado) e `resolveCardEffectsV2`/`resolveBasicEffectsV2`
     (extraídas pra serem reaproveitadas pela pilha de respostas rápidas).
   - `src/engine-v2/data.ts`: `basicTargetV2` infere o alvo da habilidade básica
     (que não tem campo `target` nos dados) a partir dos próprios efeitos — regra
     documentada como [PADRÃO] em `regras-e-decisoes.md` §6.
   - `src/engine-v2/turn.ts` (novo arquivo): `applyActionV2`/`legalActionsV2` —
     fase de compra, fase de ação (dado de movimento, básica, cartas), fase de
     descarte, alternância A/B, **pilha de respostas rápidas de verdade** (LIFO,
     testada com um caso que depende da ordem: escudo rápido em resposta absorve
     o dano que o provocou).
   - `src/engine-v2/targeting.ts`: `enumerateTargetsV2` (lista alvos candidatos,
     usada pra decidir se uma carta rápida tem alvo válido).
   - `src/engine-v2/movement.ts`: `movementBudgetV2` (lê status `move_penalty`/
     `immobilized`).
   - Testes: `tests/engine-v2-cardplay.test.ts`, `tests/engine-v2-turn.test.ts`.
5. **resurrect e death_ward** —
   - `src/engine-v2/death.ts`: `reviveChampionV2` extraído e reaproveitado pelo
     resurrect (Ressurgir da Selene); `killChampionV2` agora checa `death_ward`
     (Fênix Momentânea da Ignira) antes de matar de verdade.
   - `src/engine-v2/targeting.ts`: alvo `dead_ally` implementado (era "não
     implementado").
   - `src/engine-v2/cardPlay.ts`: `resurrectBlockedV2` (1x por partida).
   - `src/engine-v2/state.ts`/`status.ts`: campo `radius` em status (pro
     `death_ward` guardar o raio da explosão) e `resurrectUsed` por equipe.
   - Testes: `tests/engine-v2-effects-6.test.ts`.

Também escrito nesta sessão: uma regra nova em `regras-e-decisoes.md` §6 ("Alvo
da habilidade básica no roster v2") documentando a inferência de alvo das
básicas — é a única mudança de regras-e-decisoes.md desta sessão.

## O que falta (ordem de execução, do `KANBAN.md`)

Itens 1–5 da ordem de execução estão **feitos**. Faltam:

6. **Boss v2** — sem ele, a morte no motor v2 é sempre temporária (simplificação
   assumida e documentada no topo de `death.ts`); precisa decidir/implementar a
   regra equivalente à do MVP ("morte vira definitiva quando o boss cai").
7. **Monstros v2 no motor** — já tem design e dados prontos
   (`data/monsters_map.json`, `src/design/monsterPlacement.ts`,
   `src/design/monsterReaction.ts`), só falta ligar ao motor v2.
8. **Bots v2, servidor, cliente Phaser hexagonal** — só depois disso o jogo v2
   roda de ponta a ponta.

Gaps menores documentados (não bloqueiam o resto, mas estão anotados no código e
no KANBAN pra não serem esquecidos):
- `create_structure`, `hidden_trap`, `spring`, `create_portal_pair`,
  `create_walls_line`, `create_walls_shape`, `create_walls_around_target`,
  `fire_wall` — efeitos de estrutura/armadilha/portal/mola ainda não
  implementados (cada um precisa de um array de estado próprio).
- `jump_to_nearest_enemy_on_target_death`, `mark_ground_area`,
  `detonate_nearby_ground_fire`, `venom_terrain`, `fire_trail`,
  `delayed_damage` — precisam de ganchos que ainda não existem (evento de morte,
  reentrar numa área marcada, rastro de movimento, timer de efeito atrasado).
- Silêncio/atordoamento ainda não bloqueiam cartas/básicas no turno v2 (o status
  existe no catálogo, só não está checado em `turn.ts`).
- Efeito de "pisar na casa" (hazards/interagíveis) não existe no motor v2 — é
  pós-MVP mesmo no motor original.
- Propagação de controle pelo Elo (Elo Natural da Sylvane) ainda não propaga
  nada, só cria o vínculo — só o Elo de cura (Selene) propaga de verdade.
- Dano contra parede (a própria parede perder hp por dano, não só por
  `destroy_wall`) ainda não está ligado.
- Tabuleiro hexagonal: `q_size`/`r_size`/raios ainda são placeholder
  (`data/hex_board.json`), esperando o tamanho final do dono do projeto.

## Como continuar

1. Ler `KANBAN.md` (seção "Fazendo") pra pegar o parágrafo detalhado de cada
   incremento acima — tem referência exata de arquivo/função pra cada peça.
2. Próximo item natural: **boss v2**. Vai precisar de: dados do boss v2 (se já
   existem em `planejamento-jogo.md`/`claude/`, conferir), estado no
   `GameStateV2` (vida, posição, baralho de ativação), lógica de ativação
   (alcance, alvo `closest`/`last_attacker`/`aura`/`area` — mesma ideia do MVP em
   `src/engine/boss.ts`), e religar a regra de "morte definitiva com boss morto"
   em `death.ts`.
3. Sempre seguir o fluxo já estabelecido: código → teste → `npx tsc --noEmit` →
   `npx vitest run` (suite inteira) → atualizar `KANBAN.md` → commit com a
   assinatura de atribuição → push.
4. Regra do projeto continua valendo: documento de regras
   (`regras-e-decisoes.md`, no Project do claude.ai) vale mais que a conversa;
   regras [PADRÃO] valem até serem confirmadas pelo dono do projeto.
