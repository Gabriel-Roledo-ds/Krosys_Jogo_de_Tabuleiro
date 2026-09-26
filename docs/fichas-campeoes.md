# Fichas dos campeões

Valores provisórios, ajustados pela simulação. Cada ficha tem: HP, defesa, habilidade básica (0 mana, só o campeão principal do turno usa, 1 vez por turno), alcance da básica e passiva única.

Regra de desenho: alcance da básica indica o estilo. Distância maior significa campeão frágil; alcance curto significa campeão que precisa chegar perto e compensa com HP ou defesa.

## Resumo

| Campeão | Função | HP | Defesa | Básica | Alcance | Passiva |
|---|---|---|---|---|---|---|
| Atirador | Dano único | 14 | 0 | Disparo | 4 | Olho Treinado |
| Piromante | Dano em área | 14 | 0 | Faísca | 3 | Pele em Brasa |
| Andarilho | Movimentação | 16 | 1 | Passo Ágil | Pessoal | Pés Leves |
| Enredador | Controle | 18 | 1 | Laço | 2 | Presença Sufocante |
| Curandeiro | Suporte de vida | 16 | 0 | Toque | 2 | Vida Compartilhada |
| Arquiteto | Paredes e interagíveis | 20 | 2 | Barreira | 1 | Engenheiro |

## Atirador (dano único)

- **HP 14, defesa 0.**
- **Básica: Disparo.** Alcance 4, dano 2. O maior alcance entre as básicas de ataque.
- **Passiva: Olho Treinado.** +1 de dano em alvos a 3 ou mais casas de distância. Com isso, o Disparo causa 3 de dano a longa distância.
- Papel no time: finalizador de longe, frágil se for alcançado.

## Piromante (dano em área)

- **HP 14, defesa 0.**
- **Básica: Faísca.** Alcance 3, dano 1. Dano de fogo em uma casa.
- **Passiva: Pele em Brasa.** Imune a fogo, o próprio e o de aliados. Pode entrar em Chão em Chamas e Muro de Chamas sem sofrer dano.
- Papel no time: controla o espaço com fogo, e o fogo amigo não o atrapalha.

## Andarilho (movimentação)

- **HP 16, defesa 1.**
- **Básica: Passo Ágil.** Alcance pessoal (afeta só ele). +1 no movimento e, se a distância andada no turno for 5 ou mais, a equipe ganha +1 de mana (uma vez por turno). [CONFIRMADO: mudança em relação ao "+1 no dado" original]
- **Passiva: Pés Leves.** Atravessa aliados e ignora casas lentas (Teia).
- Papel no time: leva aliados e inimigos para onde os combos precisam. Não tem ataque básico: o dano vem das cartas Investida e de combos.

## Enredador (controle de grupo)

- **HP 18, defesa 1.**
- **Básica: Laço.** Alcance 2. O alvo perde 2 de movimento no próximo turno dele. Obedece o limite de 1 efeito de controle por campeão por rodada. [CONFIRMADO]
- **Passiva: Presença Sufocante.** Inimigos adjacentes a ele têm -1 no dado de movimento.
- Papel no time: linha de frente de controle, aguenta mais dano que os campeões de longe.

## Curandeiro (suporte de vida)

- **HP 16, defesa 0.**
- **Básica: Toque.** Alcance 2, cura 1.
- **Passiva: Vida Compartilhada.** Toda cura que aplica em um aliado também cura 1 nele mesmo.
- Papel no time: sustenta o time e precisa ficar perto dos aliados, então fica exposto.

## Arquiteto (paredes e interagíveis)

- **HP 20, defesa 2.**
- **Básica: Barreira.** Alcance 1 (casa adjacente). Cria 1 parede fraca com 2 de vida. [PADRÃO: definição da vida da parede]
- **Passiva: Engenheiro.** Atravessa as próprias paredes e suas estruturas têm +2 de vida.
- Papel no time: campeão mais resistente, fica na linha de frente e molda o campo.

## Ideia para o futuro: campeão de corpo a corpo

Um Berserk teria alcance 1, HP alto e passiva que aumenta o dano conforme perde vida (por exemplo +1 de dano a cada 25% de vida perdida). Ele aproveita o fogo amigo e o dano contínuo, que ignora defesa. Fica como referência para o alcance curto contra o alcance do Atirador.

## Composições de teste

- Trio Combo: Enredador, Piromante, Atirador. Total de HP 46.
- Trio Tático: Arquiteto, Andarilho, Curandeiro. Total de HP 52.

O Trio Tático tem mais HP e defesa e menos dano. A simulação mostra se isso equilibra.
