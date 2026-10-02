# Kanban

Sem prazos. Uma etapa só começa quando a anterior está pronta. Definição de pronto: regra escrita, teste automático passando e uma partida simulada completa sem erro.

## Fazendo

- Etapa 7: balanceamento com simulação (bots ainda ignoram cartas de construção)
- Motor hexagonal (roster v2): estado inicial, movimento, status e dano prontos e testados (src/engine-v2/{data,state,movement,status,damage}.ts, 34 testes) — campeões nascem na área de largada hexagonal, baralho de 30 cartas seedado, andam no hex grid (d6, 6 direções, bloqueado por campeão vivo), têm status com duração (rounds/champion_turns) e soma de amount (damage_buff/defense_buff/etc.), e dano campeão-contra-campeão já calcula bônus/defesa/escudo/reflexo igual ao MVP (com ignore_defense/ignore_shield). Falta: targeting/alcance de cartas, implementar os ~50 tipos de efeito do catálogo em claude/formato-dados.md (um por um, ligados a cards_v2.json), pilha de respostas/efeito rápido, turno completo, boss/monstros no motor novo, depois ligar bots/servidor/cliente — bem antes de jogável

## Teste

- Etapa 6: servidor (WebSocket, salas por código, bot) e cliente Phaser jogável; testado em Chromium headless (criar sala, bot, mover, atacar, turno do bot). Falta jogar com dois humanos de verdade
- Etapas 3 e 4: motor e combate implementados, 182 testes passando; falta rodar simulação com bots inteligentes

## Feito nesta rodada

- Ajustes de ritmo (d6, 1 movimento por campeão, 1 básica por turno, morte de 2 turnos, losango, mana +2, boss 40) com testes e simulação
- Interface: raios no mapa, ficha de unidade, eventos e efeitos ativos

## Backlog

- Etapa 7: balanceamento e arte definitiva
- Pós-MVP: paredes fixas, tesouros, interagíveis, mais equipes, modos com 3 ou 4 jogadores
- Roster v2 e mapa de monstros (regras-e-decisoes.md §19, claude/monstros-mapa.md) — entra em etapas, não bloqueia o MVP:
  - [feito] fichas das 40 criaturas + sistema de reação ao ataque em data/monsters_map.json (design, ainda não ligado ao motor)
  - [feito] fichas-campeoes.md (10 campeões v2) convertido pra data/champions_v2.json + data/cards_v2.json
  - [feito] testes automáticos da regra de reação com posições fictícias (src/design/monsterReaction.ts, tests/monster-reaction.test.ts, tests/data-v2.test.ts — 28 testes)
  - [feito] cartas rápidas faltando em 7 dos 10 campeões v2 — cada um ganhou 1-2 cartas rápidas (fichas-campeoes.md, data/cards_v2.json, regras-e-decisoes.md §6/§19)
  - [feito] matemática do tabuleiro hexagonal (coordenadas axiais, distância, linha de visão) e visão limitada por campeão bloqueada por obstáculo, design-only e testados (src/design/hexGrid.ts, src/design/fieldOfVision.ts, tests/hex-grid.test.ts, tests/field-of-vision.test.ts — 20 testes; regras-e-decisoes.md §20)
  - [feito] formato do mapa definido: rombo alongado em duas pontas (largadas), boss no centro, dois cantos obtusos reservados pro futuro sistema de templos/bênçãos — geometria e testes em src/design/hexBoard.ts + data/hex_board.json (14 testes). Números (tamanho, raios) são placeholder até o dono do projeto fechar o tamanho final
  - [feito] posicionamento aleatório dos 40 monstros por zona a cada partida, seedado — src/design/monsterPlacement.ts + tests/monster-placement.test.ts (10 testes)
  - [feito] `effects` estruturado das 120 cartas dos 10 campeões v2 (Niara, Borak, Ignira, Vextra, Thorne, Selene, Varek, Sylvane, Dorin, Aurelia) — data/cards_v2.json + tests/card-effects-v2.test.ts. Reaproveita o vocabulário de src/engine/effects.ts quando dá; catálogo completo dos tipos/parâmetros/status novos em claude/formato-dados.md. Nenhum deles está implementado no motor ainda — é a próxima etapa
  - [pendente] números exatos do tabuleiro (q_size/r_size, raios) e raio de visão por campeão
  - [pendente] mecânica do sistema de bênçãos/templos (ainda não especificada, só o espaço no mapa foi reservado)
  - [pendente] direção estética registrada em claude/estetica-visual.md — escolher pacotes de assets gratuitos quando chegar a etapa de arte
  - [próximo] construir o motor hexagonal (movimento, alcance, dano, mana de equipe/pessoal, sacrifícios) implementando o catálogo de tipos novos de claude/formato-dados.md, depois ligar monsters_map.json/champions_v2/cards_v2/hexGrid/fieldOfVision/hexBoard/monsterPlacement a ele, servidor e bots, cliente Phaser hexagonal, simulação e balanceamento — só então trocar o MVP pela v2

## Pronto

- Etapa 1: regras (documento de regras sem pendências bloqueantes, decisões de 2026-09-26 aplicadas)
