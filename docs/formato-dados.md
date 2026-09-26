# Formato dos dados (JSON)

Todos os arquivos ficam em `data/`. O motor lê daqui, sem números fixos no código.

## champions.json

Lista de campeões: `id`, `name`, `role`, `hp`, `defense`, `basic` (`name`, `range`, `target`, `effects`) e `passive` (`name`, `effects`).

## cards.json

Lista de cartas. Campos:

- `id`, `name`, `owner` (id do campeão, ou `monster` para cartas de recompensa), `cost`, `text`.
- `fast`: true se a carta pode ser usada no turno dos outros (efeito rápido).
- `range`: número de casas, ou `"self"`.
- `target`: `enemy`, `ally`, `champion`, `cell`, `line`, `direction`, `self`, `two_enemies`, `random_enemies`, `champion_in_line`, `wall`, `two_cells`, `dead_ally`.
- `effects`: lista de blocos de efeito, aplicados na ordem. Cada bloco tem `type` mais parâmetros (`amount`, `radius`, `distance`, `duration` etc.).
- `duration`: `{ "unit": "rounds" | "champion_turns", "value": N }`. Dano ao longo do tempo e terreno usam `rounds`. Controle em campeão usa `champion_turns`.
- `control: true` marca efeitos de controle (limite de 1 por campeão por rodada).
- `assumed_range: true` e `assumed_duration: true`: o planejamento não dizia; valor assumido como [PADRÃO] (alcance 3 quando não especificado). Revisar nos testes.

## boss.json

`hp`, `defense`, `range` e `deck` (11 cartas). Cada carta tem `target`: `closest`, `last_attacker`, `aura` ou `area`. Auras têm `aura_scope` (`boss` ou `radius`).

## monsters.json

- `types`: fichas por tipo (`weak`, `medium`, `strong`) com `hp`, `defense`, `range`, `attack`, `continuous_effect` e `reward_card` (id em cards.json).
- `placements`: os 10 monstros do mapa, com `ring` e `position` (x, y). O mapa é espelhado no eixo x (x' = 14 - x).

## balance.json

Todos os números de regra (tabuleiro, mana, mão, pilha de respostas, boss, morte). Coordenadas das áreas de largada em `teams.start_areas`.
