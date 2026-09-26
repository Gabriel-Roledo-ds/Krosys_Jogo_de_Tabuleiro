# Regras e decisões de design

Este é o documento de referência do jogo. Cada regra está marcada:

- **[DEFINIDO]** decidido por Gabe.
- **[PADRÃO]** proposto pelo Claude para destravar o MVP. Vale até ser confirmado ou trocado.
- **[PENDENTE]** ainda precisa de resposta (lista completa no fim).

Foco atual: definir e testar as mecânicas. Narrativa e identidade artística ficam para depois.

Documentos relacionados: planejamento-jogo.md (etapas, cartas, boss), fichas-campeoes.md (HP, defesa, passivas, básicas), glossario.md (termos), balance.json (números).

## 1. Pilares

- Exploração deve compensar mais do que correr para o boss. [DEFINIDO]
- Combos entre campeões são o centro do jogo, por isso a mana é generosa e as habilidades de movimento e posicionamento são fortes. [DEFINIDO]
- Dois modos no mesmo tabuleiro: jogadores contra a mesa (boss e monstros) e jogadores competindo entre si (battle royale com boss). Os campeões também batalham entre si, não só contra monstros e boss. [DEFINIDO]

## 2. Componentes

- Tabuleiro: grade quadrada grande, 15x15 como ponto de partida. [SUBSTITUÍDO pela seção 16: losango] Boss no centro, monstros espalhados. [DEFINIDO: grade grande; PADRÃO: 15x15]
- Equipes: 2 no MVP, estrutura pronta para 3 ou 4. [PADRÃO]
- Cada equipe tem 3 campeões, e os três devem se complementar. [DEFINIDO]
- Cada campeão tem uma **ficha técnica**: HP, defesa, passiva única, habilidade básica e o alcance da básica. Ver fichas-campeoes.md. [DEFINIDO]
- Cada campeão tem 1 habilidade básica (0 mana, fora do baralho) e um baralho próprio de pelo menos 10 cartas, cada uma com custo de mana proporcional ao impacto. [DEFINIDO]
- Cada jogador tem uma mão com no máximo 7 cartas. As cartas da mão pertencem cada uma a um campeão. [DEFINIDO: limite 7; PADRÃO: mão por jogador]
- Cartas de monstro e outras recompensas (tesouros no futuro) são cumulativas e não contam para o limite de 7. [DEFINIDO]
- Casas têm tipo (vazia, parede, monstro, boss etc.). Paredes fixas, tesouros e interagíveis no mapa ficam para depois do MVP, mas a estrutura de dados já os prevê. [DEFINIDO]

## 3. Preparação

- As equipes começam em lados opostos do tabuleiro, cada uma na sua região de largada. Campeões mortos voltam para lá. Com 3 ou 4 equipes, largam nos cantos. [DEFINIDO: lados opostos; PADRÃO: cantos para 3 ou 4]
- Região de largada: bloco de 3x3 no meio de cada lado. Equipe A no lado esquerdo, equipe B no lado direito. Boss na casa central (7,7). Coordenadas exatas em data/balance.json. [PADRÃO]
- Antes de as batalhas começarem no meio do tabuleiro, todos podem coletar monstros e recompensas perto de si. [DEFINIDO]
- Monstros em três anéis: perto de cada largada (fáceis, recompensa pequena), na região neutra (mais fortes) e perto do boss (os melhores). Mapa simétrico entre os lados. [PADRÃO]
- 3 tipos de monstro no MVP: fraco (carta de custo 1), médio (custo 2) e forte (custo 3). Fichas em data/monsters.json. [PADRÃO]
- Mana inicial 0. [PADRÃO]
- No primeiro turno do jogo, o jogador saca 3 cartas do baralho de um campeão à escolha (no lugar da compra normal). [DEFINIDO; ajustado na seção 16]
- No primeiro turno do jogador não há a compra normal de 1 carta: as 3 cartas a substituem. [PADRÃO]

## 4. Estrutura do turno

Os jogadores se alternam. Em cada turno:

0. **Boss:** se algum campeão do jogador estiver dentro do alcance do boss, o boss ativa a carta do topo do seu baralho (ver seção 10). [DEFINIDO: ativa no início do turno; PADRÃO: acontece antes da compra]
1. **Compra:** o jogador escolhe de qual baralho de campeão comprar 1 carta. [DEFINIDO]
2. **Ganha energia:** mana da equipe sobe (+1, teto 10), compartilhada por toda a equipe. [DEFINIDO: mana compartilhada e teto maior; CONFIRMADO: +1 e 10]
3. **(Substituído na seção 16: não há mais campeão principal; cada campeão se move uma vez.)** Escolhe o campeão principal: o campeão que vai se movimentar e usar a habilidade básica. Efeitos de duração desse campeão são processados agora (ver seção 8). [DEFINIDO; PADRÃO: momento de processar efeitos]
4. **Joga o dado** de 8 lados. [DEFINIDO]
5. **Calcula as casas:** valor do dado mais bônus de habilidades e efeitos (ex.: Passo Ágil +1, lentidão reduz). [DEFINIDO]
6. **Anda** até o valor calculado. [DEFINIDO]
7. **Usa habilidades:** a básica do campeão principal e cartas de qualquer campeão da equipe, enquanto houver mana (ver seção 6). [DEFINIDO]
8. **Calcula dano** e resolve mortes (ver seção 7). [DEFINIDO]
9. **Encerra o turno.** Se a mão passar de 7 (sem contar cartas de monstro e recompensas), o jogador descarta até ficar com 7. [DEFINIDO: limite; PADRÃO: descarte ao encerrar]

As fases 6 e 7 podem trocar de ordem, por escolha do jogador (usar carta antes de andar, por exemplo). [DEFINIDO]

## 5. Movimento

- O movimento é "até o valor": o jogador pode andar menos. [DEFINIDO]
- O movimento é interrompido por paredes, monstros e outras coisas sólidas. Algumas habilidades mudam essa interação. [DEFINIDO]
- Movimento em 8 direções, diagonal custa 1 casa. [PADRÃO]
- Campeões são sólidos: não se atravessa outro campeão sem habilidade que permita. [CONFIRMADO]
- Habilidades de movimento (Salto, Puxar, Troca de Lugar, empurrões) seguem as regras da própria carta.

## 6. Cartas e mana

- **Qualquer campeão da equipe pode usar suas cartas, desde que a equipe tenha mana para pagar.** Não precisa ser o campeão principal. [DEFINIDO]
- O alcance e a linha de visão de uma carta contam a partir do campeão dono dela, esteja onde estiver. [PADRÃO]
- Cartas podem ser usadas quantas vezes o jogador tiver mana para pagar, dentro do mesmo turno. [DEFINIDO]
- **A habilidade básica: 1 por turno para a equipe, usada por qualquer campeão (seção 16)**, custo 0. [DEFINIDO]
- Cartas usadas vão para o descarte do baralho do campeão dono. Quando o baralho de compra acaba, o descarte é embaralhado de volta. [PADRÃO]
- Custos em aberto: com teto 10, pode ser necessário criar cartas de custo 6 a 8. Decidir após os primeiros testes. [PADRÃO]
- Silêncio e atordoamento valem por campeão: um campeão silenciado não usa cartas, mas os outros dois usam normalmente. [PADRÃO]

### Efeito rápido

- Entre as cartas de campeão, algumas têm **efeito rápido** e outras não. Cada carta declara isso nos dados (campo "fast"). [DEFINIDO]
- Cartas rápidas podem ser usadas também no turno de outros jogadores, em resposta a qualquer fase. [DEFINIDO]
- A carta rápida paga mana da equipe normalmente. Quem guarda mana pode reagir no turno do adversário. [PADRÃO]
- Resolução em pilha: a última carta jogada resolve primeiro, antes da ação que provocou a resposta. Limite de 3 respostas encadeadas por ação (ajustável no balance.json). [CONFIRMADO]
- Silêncio e atordoamento também bloqueiam cartas rápidas do campeão afetado. [PADRÃO]
- Regra de projeto: rápidas devem ser cartas defensivas, reativas ou utilitárias, de custo baixo ou médio. Finalizadores de dano alto não são rápidos. [PADRÃO]
- Cartas rápidas: Recuo Tático, Retorno, Purificar, Bênção, Escudo, Escudo Reativo, Estaca e Vigia. Todas as demais não são rápidas. A lista será ajustada nos testes. [CONFIRMADO]

## 7. Combate e cálculo de dano

### Alcance e alvos

- Alcance é medido em casas, contando diagonal como 1 (distância de Chebyshev). [PADRÃO]
- Paredes bloqueiam alcance. Exceção: paredes baixas, como a Estaca do Arquiteto. [DEFINIDO: paredes bloqueiam; PADRÃO: exceção da parede baixa]
- Fogo amigo existe: áreas, empurrões e danos atingem aliados. Isso permite combos e, no futuro, campeões como um berserk que ganha dano com vida baixa. [DEFINIDO]
- Campeões de equipes diferentes podem se atacar. O dano entre equipes usa a mesma conta desta seção. [DEFINIDO]
- Empurrar e puxar movem o alvo em linha reta e param ao encontrar algo sólido. Nesse caso não há dano de colisão no MVP. [CONFIRMADO]
- Matar um campeão inimigo não dá recompensa no MVP além de tirá-lo do jogo temporariamente (ele volta à largada, ver seção 9). [PADRÃO]

### Cálculo de dano

O dano é determinístico, sem dado. A aleatoriedade do jogo fica só no movimento, para os combos serem previsíveis. [PADRÃO]

Ordem de cálculo de cada golpe:

1. **Dano base** da carta ou básica.
2. **Bônus fixos somados:** Marca do Caçador, Fúria do boss, Mira Total, passivas como Olho Treinado.
3. **Multiplicadores**, só em cartas especiais.
4. **Defesa:** subtrai o valor fixo da defesa do alvo. Se o dano base for 1 ou mais, o dano final nunca é menor que 1.
5. **Escudo** absorve o que sobrou antes da vida.
6. **Vida** cai. Vida em 0 = morte.

Regras complementares:

- Defesa é subtração fixa. [DEFINIDO]
- **Dano contínuo** (queimadura, Torre de Vigia, efeitos por rodada) ignora defesa. [DEFINIDO]
- Defesa vale para dano direto e de área, inclusive fogo amigo. [PADRÃO]
- Cura soma bônus, respeita a vida máxima e não é reduzida por defesa. [PADRÃO]
- Vários efeitos ao mesmo tempo: aplicados um por vez, na ordem em que foram jogados. [PADRÃO]
- Mortes só são resolvidas depois que toda a pilha de respostas rápidas termina, para um Escudo Reativo ou uma cura ainda poder salvar. [PADRÃO]
- Boss e monstros usam a mesma conta, com defesa própria (boss 1, monstros 0 a 1, definida na ficha). [PADRÃO]
- Último hit: conta quem tirou o último ponto de vida do boss, inclusive por dano contínuo que esse jogador colocou antes. [PADRÃO]
- Escudo absorve dano até acabar e dura até ser consumido. [PADRÃO]
- **Execução (Atirador):** dano total de 12 contra alvo marcado. A Marca do Caçador já está incluída: base 10 mais 2 da marca, antes da defesa. Contra alvo não marcado, dano 8. [CONFIRMADO: opção A]

## 8. Duração dos efeitos

- **Controle em campeão** ("próximo turno", paralisia, lentidão, silêncio, atordoamento): dura até o campeão afetado gastar o movimento do turno (ver seção 16). Se ele não for escolhido, o efeito continua. O jogador precisa gastar um turno com ele para "descongelar". [DEFINIDO]
- Habilidades de suporte podem remover controle e descongelar aliados (por exemplo, Purificar do Curandeiro). [DEFINIDO]
- **Dano ao longo do tempo (queimadura, Fogo Fátuo, Regeneração, Torre de Vigia)** conta em **rodadas**, não em turnos do campeão. O fogo continua queimando mesmo que o campeão não seja escolhido. [CONFIRMADO]
- Efeitos de terreno e estruturas (Chão em Chamas, Muralha, Muro de Chamas, Torre de Vigia) duram em **rodadas** (uma rodada = todos os jogadores jogaram um turno). [PADRÃO]
- Limite de controle: no máximo 1 efeito de controle ativo por campeão por rodada. Inclui as habilidades básicas. [PADRÃO]

## 9. Morte

- O campeão morto volta para a região de largada. [DEFINIDO]
- O jogador devolve ao baralho as cartas que pertencem ao campeão morto (as que estavam na mão) e embaralha. [DEFINIDO]
- Cartas de monstro que o campeão carregava também voltam ao baralho dele. [PADRÃO]
- No primeiro turno depois de voltar, o campeão não pode ser atingido, como se ainda estivesse fora do tabuleiro. Vale até o fim do primeiro turno em que ele for escolhido como campeão principal. [DEFINIDO: imune no primeiro turno; PADRÃO: definição de "primeiro turno"]
- Enquanto está imune, o campeão pode usar cartas, mas não pode ser alvo nem ser atingido por áreas. [PADRÃO]
- Campeão que nunca é escolhido continua parado na largada, sem regra de saída no MVP. Será medido na simulação. [CONFIRMADO como padrão]
- Ressurgir (Curandeiro): traz o aliado de volta na hora com a mão preservada, 1 vez por partida. [PADRÃO]

## 10. Boss

- Fica no centro. Vida inicial 60, defesa 1 e alcance 4. [PADRÃO]
- Tem baralho próprio de 11 cartas (ver planejamento-jogo.md). No início do turno de um jogador com algum campeão dentro do alcance, ativa a carta do topo. [DEFINIDO: baralho e ativação por alcance; PADRÃO: números]
- Cada carta do boss define seu alvo (campo `target` nos dados): [DEFINIDO]
  - `closest`: o campeão mais próximo dentro do alcance.
  - `last_attacker`: o último campeão que atacou o boss.
  - `aura`: carta passiva que fica ativa no campo e atinge todos dentro do raio, gerando efeito ou dano constante.
  - `area`: efeito imediato em área, que acaba depois de resolvido.
- Classificação das 11 cartas: [PADRÃO]
  - Mais próximo: Garra, Pisão, Agarrar, Sopro Gélido, Prole.
  - Último a atacar: Devorar, Maldição.
  - Aura: Terremoto (raio 5, 1 de dano contínuo por rodada), Fúria, Carapaça.
  - Área: Rugido (raio 3).
- No máximo 1 aura ativa por vez; a nova substitui a anterior. [PADRÃO]
- Ao sacar uma aura, o boss só a ativa e não ataca naquela ativação. [PADRÃO]
- "Último a atacar" é o último campeão que atacou o boss. Se ninguém o atacou ainda ou ele está fora do alcance, a carta atinge o mais próximo. [PADRÃO]
- Baralho esgotado: embaralha o descarte. [PADRÃO]
- Vence quem der o último hit no boss. [DEFINIDO]

## 11. Monstros

- Cada monstro tem uma ficha técnica (vida, defesa, alcance, ataque, efeito contínuo, carta que dá). [DEFINIDO]
- Têm um efeito contínuo simples. [DEFINIDO]
- Atacam quando um campeão entra no alcance deles, ou seja, ao terminar o movimento dentro do raio. [DEFINIDO: ataque ao entrar no raio; PADRÃO: só ao terminar o movimento]
- Ao ser derrotado, cada monstro dá uma carta fixa (definida na ficha) para a mão de quem deu o último hit. Monstro derrotado não volta. [DEFINIDO: carta fixa; PADRÃO: mão de quem deu o último hit]
- Cartas de monstro e recompensas são cumulativas e não contam para o limite da mão. [DEFINIDO]
- As cartas dos monstros seguem a mesma lógica de custo das cartas de campeão. [DEFINIDO]
- Monstros mais fortes dão cartas de custo mais alto, o que freia o efeito bola de neve na fase de coleta. [PADRÃO]

## 12. Riscos a medir na simulação

- Cartas de custo alto nunca serem jogadas.
- Controle em excesso travar o jogo, especialmente com a regra de efeitos que só passam no turno do campeão.
- Esperar para roubar o último hit no boss.
- Mão de 7 encher rápido com compra e cartas de monstro.
- Combos longos com mana alta encerrarem a partida cedo demais.
- Cartas rápidas em cadeia deixarem o turno do adversário lento ou impossível de prever.
- Acumular cartas de monstro sem limite de mão dar vantagem grande demais a quem explora primeiro (efeito bola de neve). Se quem coleta mais monstros sempre ganha, criar compensação, por exemplo +1 de mana por rodada para o time atrasado.
- Qualquer campeão lançando: com 3 campeões espalhados, a mesma mana pode ser usada em qualquer ponto do mapa, o que favorece jogadas muito móveis.
- Defesa fixa contra dano baixo: defesa 2 do Arquiteto zera cartas de dano 1 a 2 (cai para o mínimo de 1). Verificar se isso o deixa forte demais.
- Campeão nunca escolhido ficar congelado para sempre.
- Terremoto como aura punir demais quem fica perto do boss (ou de menos).
- Comportamento dos bots: medir partidas com bots atacando o boss e com bots atacando uns aos outros.

## 13. Decisões pendentes

Nenhuma pendência de regra bloqueia o MVP. (Contagem de monstros corrigida: são 10, não 12.) Resolvidas em 2026-09-26:

1. Mana +1 por turno, teto 10. Confirmado.
2. Queimadura e dano ao longo do tempo contam rodadas.
3. Campeão nunca escolhido: sem regra de saída no MVP (medir na simulação).
4. Alvo do boss: definido por carta (closest, last_attacker, aura, area).
5. Campeões sólidos. Confirmado.
6. Sem dano de colisão no MVP. Confirmado.
7. Cartas rápidas e limite de 3 respostas encadeadas. Confirmados.
8. Execução: total de 12 com a marca incluída (opção A).
9. Passo Ágil e Laço: mudanças de fichas-campeoes.md confirmadas.

Resolvidas antes: quem lança as cartas (qualquer campeão, com mana), habilidade básica (só o campeão principal), defesa fixa, dano contínuo ignorando defesa, mão cheia com carta de monstro (fora do limite de 7).

## 14. Decisões técnicas

- Linguagem: TypeScript (Node.js) para motor, servidor, bots e simulação. O mesmo código de regras roda no servidor e nos testes. [DEFINIDO]
- Testes: Vitest. Cada regra deste documento tem pelo menos um teste. [DEFINIDO]
- Dados: JSON em data/, lido pelo motor sem números fixos no código. [DEFINIDO]
- Online: servidor autoritativo com WebSocket, salas por código, 2 jogadores humanos no MVP. [DEFINIDO]
- Cliente: Phaser 3 com visão de cima e estilo de RPG de 16 bits, placeholders no início. [DEFINIDO]
- Aleatoriedade (dado, embaralhar) usa seed fixa para reproduzir partidas. [PADRÃO]

## 15. Decisões de implementação (todas [PADRÃO], valem até serem confirmadas)

Regras que o motor precisou fechar e que o planejamento não definia. Os números ficam em data/balance.json.

- **Morte:** o campeão sai do tabuleiro na hora, e a mão dele fica guardada. Ele volta no início do próximo turno da equipe, na largada, com vida cheia e imune. Só então as cartas dele voltam ao baralho embaralhadas. Enquanto está morto, não usa cartas.
- **Ressurgir:** só age sobre aliado morto que ainda não voltou. O aliado aparece numa casa livre adjacente ao Curandeiro, com a mão de volta e sem imunidade. 1 vez por partida.
- **Efeitos de casa** (armadilha, mola, portal, Muro de Chamas) disparam quando o campeão termina o movimento na casa ou é jogado para ela. Passar por cima não dispara.
- **Monstros** atacam ao fim de um movimento voluntário dentro do alcance, não em empurrões nem puxões.
- **Cartas de monstro** são consumíveis: depois de usadas, somem (não vão para o descarte).
- **Duração de paredes:** Barreira, Estaca, Muralha, Barricada e Cúpula duram as rodadas da carta ou 3 rodadas (Barreira e Estaca). Portal 4 rodadas, Mola 4 rodadas. Vida das paredes: 2 (+2 do Engenheiro). Reforçar torna permanente.
- **Boss:** o alvo `closest` é o campeão mais próximo do jogador da vez; `last_attacker` cai para o mais próximo se o último atacante estiver morto ou fora do alcance. Lacaios atacam como monstros (ao fim do movimento adjacente).
- **Fúria** conta cartas do boss que resolvem depois dela; termina após 2. **Carapaça** zera na próxima ativação do boss.
- **Cartas rápidas** respondem a cartas, básicas e ativações do boss. Movimento não abre janela de resposta. Na ativação do boss, quem responde primeiro é o jogador da vez.
- **Vento Lateral:** sem escolha de destino, cada aliado avança em direção ao boss.
- **Ricochete:** o segundo alvo é o inimigo mais próximo do primeiro, a até 2 casas.
- **Passo Ágil:** o +1 de mana vale se, depois de usar a básica, o total andado no turno chegar a 5.
- **Elo:** o parceiro sofre metade do dano final (arredondado para baixo, mínimo 1), sem defesa e sem repassar de novo.

## 16. Ajustes de ritmo (26/09/2026, pedidos do dono do projeto após jogar)

O jogo estava lento. Estas regras substituem as anteriores onde houver conflito. Marcadas [DEFINIDO] são pedidos ou respostas do dono; [PADRÃO] são escolhas da implementação, valem até serem confirmadas.

- **Dado:** d6 (antes d8), rolado **uma vez por turno**, no começo da fase de ação, valendo para o time inteiro. [DEFINIDO]
- **Sem campeão principal.** No turno, **cada campeão pode se mover uma vez**, até o valor do dado (menos penalidades). O movimento de um campeão pode ser dividido em etapas enquanto ele é o último a se mover; ao mover outro campeão, o anterior não anda mais. [DEFINIDO: uma vez por campeão; PADRÃO: divisão em etapas]
- **Só uma habilidade básica por turno**, usada por qualquer campeão da equipe (não precisa ser o que se moveu). [DEFINIDO]
- **Cartas:** qualquer campeão vivo usa cartas com a mana da equipe, como antes.
- **Controle** (imobilizado, atordoado, silenciado, lentidão): dura até o campeão afetado gastar o movimento do turno dele. Quem está imobilizado usa "ficar parado" para gastar o movimento e se soltar; mover outro campeão não solta ninguém. Controle aplicado a quem já se moveu neste turno só começa a valer no turno seguinte da equipe. [DEFINIDO: gasta o próprio movimento; PADRÃO: detalhes]
- **Compra:** continua 1 carta por turno, do baralho de um campeão à escolha. **Com 7 ou mais cartas de habilidade na mão dá para não comprar** (a mana do turno é ganha do mesmo jeito). [DEFINIDO]
- **Primeiro turno do jogo:** compra 3 cartas de um baralho (era ao escolher o principal). [PADRÃO]
- **Mana:** +2 por turno (era +1), teto 10. [PADRÃO, sob teste na simulação]
- **Boss:** 40 de vida (era 60). [PADRÃO, sob teste na simulação]
- **Morte:** o campeão fica **fora por 2 turnos da própria equipe** e volta no início do terceiro, na largada, com vida cheia e intocável até o fim desse turno. A mão dele fica guardada e volta ao baralho quando ele retorna. Ressurgir continua trazendo o aliado na hora. [DEFINIDO: 2 rodadas fora; PADRÃO: contagem em turnos da equipe]
- **Tabuleiro em losango** 15x15: só existem casas com |x-7|+|y-7| <= 7 (113 casas). Equipe A na ponta esquerda, equipe B na ponta direita, boss no centro. Movimento, alcance e áreas continuam em distância de Chebyshev; o que cai fora do losango não existe (empurrões param na borda). [DEFINIDO: losango com um time em cada ponta; PADRÃO: raio 7]
- **Terremoto** (aura do boss): raio 5 (era 4). O alcance de ativação do boss continua 4. [PADRÃO]
- **Interface:** raios de ataque dos monstros, do boss e da aura aparecem no mapa; clicar num campeão, monstro ou no boss abre uma ficha com vida, defesa, passiva, alcance e efeitos ativos com duração; um quadro à esquerda mostra os eventos (quem entrou no raio de quem, quem atacou, dano e efeitos) e os efeitos ativos. [DEFINIDO]
- Correção: Ressurgir não é mais oferecido depois de usado.
