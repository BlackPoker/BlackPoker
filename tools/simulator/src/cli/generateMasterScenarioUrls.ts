import { encodeScenarioDefinitionV1ToUrlParam } from "../ui/scenario/ScenarioShareUrl";
import { ScenarioDefinitionV1 } from "../domain/scenario/ScenarioTypes";
import { buildPlaytestShareUrl } from "../ui/playtest/PlaytestShareUrl";

// 1. 徴募 (Recruit) シナリオ
const recruitScenario: ScenarioDefinitionV1 = {
  version: 1,
  name: "徴募順序選択検証",
  environmentId: "official:mast-strategy",
  seed: 42,
  turnPlayer: "p1",
  chancePlayer: "p1",
  turnCount: 1,
  players: {
    p1: {
      hand: [
        { suit: "D", rank: "2" },
        { suit: "D", rank: "3" },
      ],
      field: [
        {
          componentId: "character.bulwark",
          cards: [{ suit: "S", rank: "4" }],
          face: "down",
          state: "charge",
        },
        {
          componentId: "character.bulwark",
          cards: [{ suit: "H", rank: "4" }],
          face: "down",
          state: "charge",
        },
      ],
      life: {
        cards: [
          { suit: "S", rank: "3" }, // <= 5: 兵士化
          { suit: "C", rank: "6" }, // > 5: 超過A
          { suit: "H", rank: "8" }, // > 5: 超過B
          { suit: "S", rank: "2" }, // <= 5: 兵士化
        ],
        count: 20,
      },
      pack: { count: 14, opened: false },
    },
    p2: {
      hand: [
        { suit: "C", rank: "A" },
        { suit: "C", rank: "2" },
        { suit: "C", rank: "3" },
      ],
      life: { count: 20 },
      pack: { count: 14, opened: false },
    },
  },
};

// 2. B・J (Blackjack) シナリオ
const bjScenario: ScenarioDefinitionV1 = {
  version: 1,
  name: "BJヒットスタンド及びバースト検証",
  environmentId: "official:mast-strategy",
  seed: 42,
  turnPlayer: "p1",
  chancePlayer: "p1",
  turnCount: 1,
  players: {
    p1: {
      hand: [
        { suit: "S", rank: "A" },
        { suit: "H", rank: "J" },
      ],
      life: {
        cards: [
          { suit: "S", rank: "10" }, // 10点
          { suit: "H", rank: "K" },  // 10点 (合計20点)
          { suit: "C", rank: "5" },  // 5点 (合計25点: バースト)
        ],
        count: 20,
      },
      pack: { count: 14, opened: false },
    },
    p2: {
      hand: [
        { suit: "C", rank: "A" },
        { suit: "C", rank: "2" },
        { suit: "C", rank: "3" },
      ],
      life: { count: 20 },
      pack: { count: 14, opened: false },
    },
  },
};

const recruitShareUrl = buildPlaytestShareUrl("http://localhost:4173/?preview=all", {
  environmentId: "official:mast-strategy",
  mode: "humanVsHuman",
  seedInput: "42",
  scenarioDefinition: recruitScenario,
});

const bjShareUrl = buildPlaytestShareUrl("http://localhost:4173/?preview=all", {
  environmentId: "official:mast-strategy",
  mode: "humanVsHuman",
  seedInput: "42",
  scenarioDefinition: bjScenario,
});

console.log("RECRUIT_URL:", recruitShareUrl);
console.log("BJ_URL:", bjShareUrl);
