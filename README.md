# Krósys: jogo de campeões contra um boss

> **Experimento 100% feito com IA.** Este projeto é um experimento em que as regras, os dados, o código e a documentação são criados em conversa com o Claude (Anthropic). As decisões de design são de Gabe; a IA propõe, escreve e testa.

Jogo de tabuleiro digital, por turnos, para jogar online com amigos. Duas equipes de três campeões começam em lados opostos de um tabuleiro 15x15. No centro está um boss, e pelo mapa há monstros que dão cartas ao serem derrotados. **Vence quem der o último golpe no boss.**

Estado atual: definindo e testando as mecânicas. Narrativa e arte ficam para depois.

## Ideia central

- **Explorar compensa mais que correr para o boss.** Monstros dão cartas, e as cartas dos mais fortes custam mais mana.
- **Dois modos no mesmo tabuleiro:** jogadores contra a mesa (boss e monstros) e jogadores contra jogadores (battle royale com boss).
- **Combos entre campeões** são o centro do jogo: puxar inimigos para dentro de uma bola de fogo, empurrar alvos contra paredes.
- **Só o movimento usa dado** (d8). O dano é fixo, sem sorte, para os combos serem previsíveis.

## Como se joga

Cada equipe tem 3 campeões, e cada campeão tem uma ficha (HP, defesa, passiva, habilidade básica) e um baralho próprio de 10 cartas com custo de mana. A mana é compartilhada pela equipe (+1 por turno, teto 10), e qualquer campeão pode usar suas cartas enquanto houver mana.

Em cada turno o jogador:

1. Deixa o boss atacar, se algum campeão estiver no alcance dele.
2. Compra 1 carta do baralho de um campeão à escolha.
3. Ganha mana.
4. Escolhe o campeão principal do turno.
5. Rola o dado e anda até o valor calculado.
6. Usa a habilidade básica do campeão principal e cartas de qualquer campeão, enquanto houver mana.
7. Resolve dano e mortes. A mão fica com no máximo 7 cartas.

Algumas cartas têm **efeito rápido** e podem ser usadas no turno dos adversários, em resposta. Campeões mortos voltam à largada, imunes até o fim do primeiro turno, e devolvem suas cartas ao baralho.

## As seis classes

| Classe | Função |
|---|---|
| Atirador | Dano único, de longe |
| Piromante | Dano em área e fogo |
| Andarilho | Movimentação |
| Enredador | Controle de grupo |
| Curandeiro | Suporte de vida |
| Arquiteto | Paredes e interagíveis |

Composições de teste: **Trio Combo** (Enredador, Piromante, Atirador) contra **Trio Tático** (Arquiteto, Andarilho, Curandeiro).

## O boss

Fica no centro com 60 de vida e ataca com um baralho de 11 cartas. Cada carta define seu alvo: o campeão mais próximo, o último que o atacou, ou uma aura que atinge todos no raio.

## Como o projeto está organizado

- `docs/`: `regras-e-decisoes.md` (referência principal), `planejamento-jogo.md`, `fichas-campeoes.md`, `glossario.md` e `formato-dados.md`.
- `data/`: `balance.json` (todos os números ajustáveis), campeões, cartas, boss e monstros em JSON. O motor lê tudo daqui.
- `src/`: código em TypeScript (motor, bots, simulação, servidor, cliente).
- `tests/`: um teste por regra.
- `KANBAN.md`: andamento das etapas.

## Etapas

Regras, dados, motor, combate, bots e simulação, servidor online com cliente jogável (visão de cima, estilo RPG de 16 bits), balanceamento. Uma etapa está pronta quando a regra está escrita, tem teste automático e passou numa partida simulada. Detalhes em `docs/planejamento-jogo.md` e `KANBAN.md`.

## Comandos

```
npm install
npm test        # roda os testes (Vitest)
npm run sim     # roda partidas simuladas com bots (quando existir)
```

## Regra de ouro

Em caso de conflito, o documento de regras vale mais que a conversa. Regras marcadas como padrão valem até serem confirmadas.
