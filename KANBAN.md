# Kanban

Sem prazos. Uma etapa só começa quando a anterior está pronta. Definição de pronto: regra escrita, teste automático passando e uma partida simulada completa sem erro.

## Fazendo

- Etapa 7: balanceamento com simulação (bots ainda ignoram cartas de construção)

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
  - [feito] testes automáticos da regra de reação com posições fictícias (src/design/monsterReaction.ts, tests/monster-reaction.test.ts, tests/data-v2.test.ts — 27 testes)
  - [pendente] decidir o achado de cartas rápidas faltando em 7 dos 10 campeões v2 (ver regras-e-decisoes.md §6/§19)
  - tabuleiro hexagonal
  - ligar monsters_map.json/champions v2 ao motor

## Pronto

- Etapa 1: regras (documento de regras sem pendências bloqueantes, decisões de 2026-09-26 aplicadas)
