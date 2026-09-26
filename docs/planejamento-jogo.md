# Planejamento do jogo (MVP)

Números são provisórios. A simulação com bots ajusta tudo na etapa de balanceamento.

## Etapas (em ordem, sem prazo fixo)

Método: Kanban (ver KANBAN.md na raiz). Colunas: Backlog, Fazendo, Teste, Pronto. Uma etapa só começa quando a anterior está pronta.

1. **Regras:** documento único com tabuleiro (15x15), turno, dado, mana compartilhada, mão (máx. 7), compra, morte, vitória. Define o formato JSON de cartas, classes, monstros e boss.
2. **Dados:** 6 classes com 10 cartas cada, baralho do boss e fichas dos monstros em arquivos JSON.
3. **Motor (TypeScript):** tabuleiro, turnos, movimento, mana, compra por baralho escolhido, mão, morte e retorno ao início.
4. **Combate:** alcance, habilidades, status (queimadura, lentidão, escudo, silêncio), monstros com ficha técnica, boss com baralho e auras.
5. **Bots e simulação:** partidas bot contra bot para achar bugs e medir equilíbrio (custos de mana, ladrão de último hit, cartas nunca jogadas, bots contra o boss e bots contra bots).
6. **Servidor online e cliente:** (a) cliente Phaser jogável local contra bot, com placeholders; (b) multiplayer em sala com código, mais reconexão.
7. **Balanceamento** com base nos números da simulação, e arte definitiva.
8. **Pós-MVP:** paredes fixas no mapa, tesouros, interagíveis, mais equipes, boss com ritmo próprio, modos com 3 ou 4 jogadores.

Definição de pronto: regra escrita no documento, teste automático passando e uma partida simulada completa sem erro.

## Pilha técnica

- TypeScript + Node.js (motor, servidor, bots, simulação), Vitest (testes), `ws` (WebSocket), Phaser 3 + Vite (cliente).
- Estrutura: `data/` (JSONs), `src/engine/` (regras), `src/bots/`, `src/sim/`, `src/server/`, `src/client/`, `tests/`, `docs/`.
- Servidor autoritativo: o cliente só envia intenções, o servidor valida com o motor. Cada jogador só recebe a própria mão.
- Comandos: `npm test` roda os testes, `npm run sim` roda a simulação.

## Regras do baralho

- Cada campeão tem 1 habilidade básica (0 mana, sempre disponível, fora do baralho) e 10 cartas no baralho.
- Cartas de monstro derrotado entram na mão de quem deu o último hit, além das 10.
- Mana: +1 por turno, teto 10, compartilhada pela equipe. Qualquer campeão usa suas cartas se houver mana.
- HP, defesa, passiva e alcance da básica de cada campeão estão em fichas-campeoes.md. O cálculo de dano está em regras-e-decisoes.md, seção 7.

## Boss

- Vida inicial: 60. Defesa: 1. Alcance de ativação: 4 casas.
- No início do turno de um jogador com algum campeão dentro do alcance, o boss compra a carta do topo do baralho e ela resolve conforme o tipo de alvo da carta.
- Tipos de alvo: `closest` (mais próximo no alcance), `last_attacker` (último campeão que atacou o boss), `aura` (passiva que atinge todos no raio enquanto ativa) e `area` (efeito imediato em área).
- No máximo 1 aura ativa por vez; a nova substitui a anterior. Ao sacar uma aura, o boss só a ativa e não ataca.
- Baralho esgotado: descarte é embaralhado de novo.

| # | Carta | Alvo | Efeito |
|---|-------|------|--------|
| 1 | Garra | closest | 3 de dano ao alvo |
| 2 | Rugido | area (raio 3) | Todos em raio 3 são empurrados 3 casas e recebem 1 de dano |
| 3 | Pisão | closest | 2 de dano no alvo e em quem estiver adjacente a ele |
| 4 | Sopro Gélido | closest | Alvo perde 3 de movimento no próximo turno |
| 5 | Devorar | last_attacker | 4 de dano ao alvo, boss recupera 2 de vida |
| 6 | Prole | closest | Invoca um lacaio (3 de vida, 1 de dano) adjacente ao alvo |
| 7 | Fúria | aura (boss) | Próximas 2 cartas do boss causam +1 de dano |
| 8 | Terremoto | aura (raio 5) | 1 de dano contínuo por rodada a todos os campeões em raio 5 (ignora defesa) |
| 9 | Agarrar | closest | 2 de dano e o alvo não se move no próximo turno |
| 10 | Maldição | last_attacker | Alvo descarta 1 carta aleatória da mão |
| 11 | Carapaça | aura (boss) | Boss ignora 2 de dano até o próximo turno dele |

## Monstros (MVP)

10 monstros: 4 fracos (2 perto de cada largada), 4 médios na região neutra e 2 fortes perto do boss. Fichas em data/monsters.json.

| Tipo | Vida | Defesa | Alcance | Ataque | Carta dada |
|------|------|--------|---------|--------|------------|
| Fraco | 4 | 0 | 1 | 1 | custo 1 |
| Médio | 7 | 0 | 2 | 2 | custo 2 |
| Forte | 10 | 1 | 2 | 3 | custo 3 |

## Classes e baralhos

### 1. Atirador (dano único)
Básica: Disparo, alcance 4, dano 2.

| Carta | Custo | Rápida | Efeito |
|-------|-------|--------|--------|
| Tiro Rápido | 1 | não | Dano 2, alcance 5 |
| Recuo Tático | 1 | sim | Move 2 casas para longe de um alvo |
| Marca do Caçador | 2 | não | Alvo marcado recebe +2 de qualquer fonte |
| Tiro na Perna | 2 | não | Dano 1 e alvo perde 2 de movimento no próximo turno |
| Vigia | 2 | sim | Próximo inimigo que entrar no alcance 5 recebe 3 de dano |
| Tiro Perfurante | 3 | não | Dano 5 |
| Disparo Duplo | 3 | não | Dois tiros de 2 de dano em alvos diferentes |
| Ricochete | 3 | não | Dano 3 e 2 de dano num segundo alvo a até 2 casas do primeiro |
| Mira Total | 4 | não | Próxima carta ganha +3 de alcance e +2 de dano |
| Execução | 5 | não | Dano 8, ou 12 no total se o alvo estiver marcado (a marca já está incluída) |

### 2. Piromante (dano em área)
Básica: Faísca, alcance 3, dano 1.

| Carta | Custo | Rápida | Efeito |
|-------|-------|--------|--------|
| Brasa | 1 | não | 1 de dano em raio 1 ao redor de um ponto a até 3 casas |
| Fogo Fátuo | 1 | não | Uma casa a até 3 pega fogo: 1 de dano por rodada durante 2 rodadas |
| Chão em Chamas | 2 | não | Área 3x3, 1 de dano por rodada durante 2 rodadas |
| Rastro de Fogo | 2 | não | Casas por onde o campeão passou neste turno queimam 1 por 2 rodadas |
| Combustão | 2 | não | Alvo em chamas ou em chão em chamas recebe 3 de dano |
| Bola de Fogo | 3 | não | Dano 3 em raio 1 |
| Muro de Chamas | 3 | não | Linha de 4 casas: 2 de dano a quem entrar, dura 2 rodadas |
| Chuva de Faíscas | 3 | não | 1 de dano em 3 alvos aleatórios a até 5 casas |
| Nova | 4 | não | 2 de dano em raio 2 ao redor do próprio campeão e empurra 1 casa |
| Explosão | 5 | não | Dano 5 em raio 2 |

### 3. Andarilho (movimentação)
Básica: Passo Ágil, +1 no movimento; se andar 5 ou mais casas no turno, a equipe ganha +1 de mana (1 vez por turno).

| Carta | Custo | Rápida | Efeito |
|-------|-------|--------|--------|
| Corrida | 1 | não | +3 de movimento neste turno |
| Retorno | 1 | sim | Volta à casa onde começou o turno |
| Puxar | 2 | não | Puxa um campeão em linha até 3 casas |
| Troca de Lugar | 2 | não | Troca de posição com qualquer campeão a até 5 casas |
| Impulso Aliado | 2 | não | Um aliado a até 3 casas se move 3 casas |
| Arrasto | 2 | não | Move 4 casas levando junto um aliado adjacente |
| Investida | 2 | não | Move 3 em linha e causa 2 de dano ao primeiro alvo no caminho |
| Salto | 3 | não | Teletransporte de até 6 casas |
| Vento Lateral | 3 | não | Todos os aliados se movem 2 casas |
| Atalho | 4 | não | Neste turno o campeão atravessa campeões e paredes fracas |

### 4. Enredador (controle de grupo)
Básica: Laço, alcance 2, alvo perde 2 de movimento no próximo turno.

| Carta | Custo | Rápida | Efeito |
|-------|-------|--------|--------|
| Teia | 1 | não | Uma casa fica lenta por 2 rodadas (custa 2 de movimento para entrar) |
| Amarras | 2 | não | Inimigos adjacentes perdem 2 de movimento no próximo turno |
| Empurrão | 2 | não | Empurra o alvo 3 casas |
| Gancho | 2 | não | Puxa o alvo 2 casas e causa 1 de dano |
| Raízes | 2 | não | Alvo não se move no próximo turno |
| Provocar | 2 | não | Alvo é obrigado a se mover 3 casas em direção ao Enredador |
| Rede | 3 | não | Área 3x3: inimigos perdem 3 de movimento no próximo turno |
| Elo | 3 | não | Liga 2 inimigos a até 4 casas: dano em um causa metade no outro por 2 rodadas |
| Atordoar | 4 | não | Alvo perde a ação de habilidade no próximo turno |
| Silêncio | 4 | não | Alvo não pode usar cartas por 1 turno |

Limite: 1 efeito de controle por campeão por rodada.

### 5. Curandeiro (suporte de vida)
Básica: Toque, alcance 2, cura 1.

| Carta | Custo | Rápida | Efeito |
|-------|-------|--------|--------|
| Bênção | 1 | sim | Cura 2 |
| Purificar | 1 | sim | Remove efeitos negativos de um aliado (descongela) |
| Sacrifício | 1 | não | O Curandeiro perde 2 de vida e um aliado recupera 4 |
| Cura | 2 | não | Cura 4 |
| Escudo | 2 | sim | Absorve 3 de dano |
| Escudo Reativo | 2 | sim | Absorve 2 e reflete 1 de dano ao atacante |
| Regeneração | 2 | não | Cura 1 por rodada durante 3 rodadas |
| Aura Vital | 3 | não | Cura 2 em todos os aliados em raio 2 |
| Santuário | 4 | não | Área 3x3: aliados dentro ficam imunes a controle por 2 rodadas |
| Ressurgir | 5 | não | Aliado morto volta na hora com a mão preservada. 1 vez por partida |

### 6. Arquiteto (paredes e interagíveis)
Básica: Barreira, alcance 1, cria 1 parede fraca com 2 de vida.

| Carta | Custo | Rápida | Efeito |
|-------|-------|--------|--------|
| Estaca | 1 | sim | Cria uma parede baixa (bloqueia movimento, não bloqueia alcance) |
| Reforçar | 1 | não | Uma parede ganha +3 de vida e vira permanente |
| Demolir | 2 | não | Destrói uma parede e causa 2 de dano a quem estiver adjacente |
| Muralha | 2 | não | 3 paredes em linha por 3 rodadas |
| Armadilha | 2 | não | Casa oculta que causa 3 de dano a quem pisar |
| Mola | 2 | não | Casa que lança quem pisar 3 casas na direção escolhida |
| Barricada | 3 | não | Parede de 5 casas em L por 2 rodadas |
| Torre de Vigia | 3 | não | Estrutura com 3 de vida: causa 2 de dano por rodada a inimigos em alcance 3 |
| Portal | 4 | não | Par de portais que qualquer campeão pode usar |
| Cúpula | 4 | não | Paredes 3x3 ao redor de um aliado por 2 rodadas |

## Composições de teste

- Trio Combo: Enredador, Piromante, Atirador.
- Trio Tático: Arquiteto, Andarilho, Curandeiro.

## Riscos a medir na simulação

- Cartas de mana 5 podem nunca ser jogadas.
- Controle em excesso trava o jogo.
- Esperar para roubar o último hit no boss.
- Mão de 7 pode encher rápido com compra de 1 por turno e cartas de monstro.
- Terremoto como aura pode punir demais quem fica perto do boss.
