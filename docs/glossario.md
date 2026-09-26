# Glossário

Termos com significado fixo. Toda carta, teste e trecho de código deve usar estas definições.

## Espaço e medidas

- **Casa:** uma célula da grade.
- **Distância:** número de casas entre duas casas, contando diagonal como 1.
- **Adjacente:** distância 1, incluindo diagonais.
- **Alcance N:** o alvo (ou o ponto de origem da área) precisa estar a distância N ou menos do campeão dono da carta (ou da básica), com caminho livre de paredes (ver Linha de visão). Alcance "pessoal" afeta só o próprio campeão.
- **Raio N:** todas as casas a distância N ou menos do ponto central. Raio 1 = quadrado 3x3, raio 2 = quadrado 5x5.
- **Área 3x3:** quadrado de 9 casas. O centro é escolhido dentro do alcance da carta.
- **Linha:** casas em fila reta (horizontal, vertical ou diagonal) a partir de um ponto.
- **Linha de visão:** existe quando a reta entre lançador e alvo não passa por parede. Parede baixa não bloqueia.
- **Sólido:** qualquer coisa que impede movimento (parede, monstro, boss, campeão, estrutura). Exceções são dadas por habilidades específicas.

## Tempo

- **Turno:** vez de um jogador, seguindo as fases do documento de regras.
- **Rodada:** todos os jogadores jogaram um turno.
- **Campeão principal:** o campeão escolhido na fase 3 para se movimentar naquele turno. Só ele usa a habilidade básica. Qualquer campeão da equipe pode usar cartas, se houver mana.
- **Campeão dono da carta:** o campeão a quem a carta pertence. Alcance e linha de visão contam a partir dele.
- **Turno do campeão:** turno em que aquele campeão foi escolhido como campeão principal.
- **Próximo turno (efeito em campeão):** o próximo turno do campeão afetado. Se ele não for escolhido, o efeito permanece (o campeão fica "congelado" até gastar um turno).
- **Duração em rodadas:** usada por dano ao longo do tempo (queimadura), efeitos de terreno e estruturas.

## Recursos

- **Mana:** recurso da equipe, compartilhado entre os campeões. Sobe na fase 2 até o teto.
- **Custo:** mana gasta para usar uma carta. A habilidade básica custa 0.
- **Baralho:** pilha de compra de um campeão. Cada campeão tem o seu.
- **Mão:** cartas do jogador (máximo 7). Cada carta lembra qual campeão é o dono.
- **Descarte:** cartas já usadas de um campeão. Volta ao baralho quando ele acaba.
- **Habilidade básica:** ação de 0 mana, exclusiva do campeão, fora do baralho. Só o campeão principal do turno a usa, 1 vez por turno.
- **Carta de monstro:** carta fixa recebida ao derrotar um monstro. Não conta para o limite da mão.
- **Efeito rápido:** carta que também pode ser usada no turno de outros jogadores, em resposta a qualquer fase.
- **Pilha:** ordem de resolução das respostas rápidas. A última carta jogada resolve primeiro.
- **Ficha do campeão:** HP, defesa, passiva, habilidade básica e alcance da básica (ver fichas-campeoes.md).
- **Passiva:** habilidade única e permanente do campeão, sem custo e sem carta.

## Movimento forçado

- **Empurrar N:** move o alvo N casas em linha reta, afastando-o da origem. Para antes de um sólido.
- **Puxar N:** move o alvo N casas em linha reta em direção à origem. Para antes de um sólido.
- **Teletransporte:** o campeão sai de uma casa e aparece em outra, ignorando o que existe no caminho. A casa de destino precisa estar livre.
- **Trocar de lugar:** dois campeões trocam de casa.

## Efeitos

- **Dano:** reduz vida. Vida em 0 = morte. Escudo absorve antes da vida.
- **Dano base:** valor escrito na carta ou básica, antes de bônus e defesa.
- **Bônus fixo:** valor somado ao dano base (Marca do Caçador, Fúria, Mira Total, passivas).
- **Defesa:** valor fixo subtraído do dano direto e de área. O dano final nunca é menor que 1 se o dano base for 1 ou mais.
- **Dano contínuo:** dano por rodada de efeitos (queimadura, Torre de Vigia, aura Terremoto). Ignora defesa.
- **Ordem do cálculo:** dano base, bônus fixos, multiplicadores, defesa, escudo, vida.
- **Cura:** recupera vida, sem passar do máximo.
- **Escudo:** absorve dano até acabar e dura até ser consumido.
- **Perder movimento N:** o valor de casas calculado na fase 5 do próximo turno do campeão cai em N (mínimo 0).
- **Imobilizado:** não pode andar no próximo turno dele (Raízes, Agarrar).
- **Silenciado:** não pode usar cartas de habilidade no próximo turno dele (a básica continua permitida). Silêncio: Enredador.
- **Atordoado:** perde a fase de uso de cartas no próximo turno dele, inclusive a básica.
- **Controle de grupo:** efeitos que limitam ação ou movimento de um campeão (perder movimento, imobilizar, silenciar, atordoar, empurrar, puxar, provocar). Limite de 1 efeito de controle ativo por campeão por rodada.
- **Queimadura:** dano contínuo por rodada durante a duração indicada na carta.
- **Marca:** alvo marcado recebe dano extra indicado pela carta, de qualquer fonte.
- **Efeito contínuo:** efeito simples e permanente de um monstro, ativo enquanto ele está vivo.

## Campo

- **Parede fraca:** parede com pouca vida, destruída por dano.
- **Parede baixa:** bloqueia movimento, não bloqueia alcance.
- **Parede permanente:** deixa de expirar (Reforçar).
- **Interagível:** objeto no campo com efeito ao ser pisado ou usado (armadilha, mola, portal, torre).
- **Armadilha oculta:** interagível que os inimigos não veem até ser ativado.
- **Fora do tabuleiro:** estado de campeão recém-morto: não pode ser alvo até o fim do primeiro turno dele depois de voltar.

## Combate e vitória

- **Último hit:** o golpe que reduz a vida do boss (ou monstro) a 0. Quem o dá vence a partida (boss) ou recebe a carta (monstro).
- **Ativação do boss:** início do turno de um jogador com campeão dentro do alcance do boss, quando ele usa a carta do topo do baralho.
- **Alvo do boss:** cada carta do boss define: `closest` (mais próximo no alcance), `last_attacker` (último campeão que atacou o boss), `aura` (passiva ativa que atinge todos no raio) ou `area` (efeito imediato em área).
- **Aura do boss:** carta passiva que fica ativa no campo. No máximo 1 por vez; a nova substitui a anterior.
- **Fogo amigo:** dano, empurrão e efeitos negativos atingem aliados também.
- **Ficha técnica:** cartão do monstro com vida, alcance, ataque, efeito contínuo e a carta que ele dá.
