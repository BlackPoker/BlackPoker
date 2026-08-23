/**
 * Core Battle Playtest 用の固定初期盤面 (Preset ID: CORE-BATTLE-001)
 *
 * 【特徴】
 * - 各プレイヤー Life 8枚 (Card[] 形式)
 * - 各プレイヤー: charge 状態の兵士2体、裏向き防壁1体
 * - 各プレイヤー: ツイスト等の Quick アクションを試せるコスト手札
 * - 最初のターンから Attack / Block / DamageJudge / Quick / End / Charge / Draw を短時間で体験可能
 */

export const CORE_BATTLE_PRESET_ID = "CORE-BATTLE-001";

export function createCoreBattlePresetState(): any {
  return {
    stateVersion: 1,
    version: 1,
    presetId: CORE_BATTLE_PRESET_ID,
    turnPlayer: "p1",
    chancePlayer: "p1",
    turnCount: 1,
    actionCount: 0,
    players: {
      p1: {
        name: "Player A",
        life: [
          { id: "p1-l1", suit: "S", rank: "2", value: 2 },
          { id: "p1-l2", suit: "H", rank: "3", value: 3 },
          { id: "p1-l3", suit: "D", rank: "4", value: 4 },
          { id: "p1-l4", suit: "C", rank: "5", value: 5 },
          { id: "p1-l5", suit: "S", rank: "7", value: 7 },
          { id: "p1-l6", suit: "H", rank: "8", value: 8 },
          { id: "p1-l7", suit: "D", rank: "9", value: 9 },
          { id: "p1-l8", suit: "C", rank: "10", value: 10 },
        ],
        hand: [
          { id: "p1-h1", suit: "D", rank: "5", value: 5 }, // ツイストコスト用
          { id: "p1-h2", suit: "C", rank: "2", value: 2 },
        ],
        field: [
          {
            unitId: "soldier-p1-1",
            componentId: "character.soldier",
            kind: "一般兵",
            state: "charge",
            cards: [{ id: "p1-c1", suit: "S", rank: "6", value: 6 }],
            labels: ["攻撃", "防御"],
          },
          {
            unitId: "soldier-p1-2",
            componentId: "character.soldier",
            kind: "一般兵",
            state: "charge",
            cards: [{ id: "p1-c2", suit: "H", rank: "5", value: 5 }],
            labels: ["攻撃", "防御"],
          },
          {
            unitId: "bw-p1",
            componentId: "character.bulwark",
            kind: "防壁",
            face: "down",
            state: "charge",
            cards: [{ id: "p1-c3", suit: "D", rank: "4", value: 4 }],
            labels: ["防御"],
          },
        ],
        fog: [],
        trump: [],
        grave: [],
      },
      p2: {
        name: "Player B",
        life: [
          { id: "p2-l1", suit: "C", rank: "2", value: 2 },
          { id: "p2-l2", suit: "D", rank: "3", value: 3 },
          { id: "p2-l3", suit: "H", rank: "4", value: 4 },
          { id: "p2-l4", suit: "S", rank: "5", value: 5 },
          { id: "p2-l5", suit: "C", rank: "7", value: 7 },
          { id: "p2-l6", suit: "D", rank: "8", value: 8 },
          { id: "p2-l7", suit: "H", rank: "9", value: 9 },
          { id: "p2-l8", suit: "S", rank: "10", value: 10 },
        ],
        hand: [
          { id: "p2-h1", suit: "D", rank: "6", value: 6 }, // ツイストコスト用
          { id: "p2-h2", suit: "C", rank: "3", value: 3 },
        ],
        field: [
          {
            unitId: "soldier-p2-1",
            componentId: "character.soldier",
            kind: "一般兵",
            state: "charge",
            cards: [{ id: "p2-c1", suit: "C", rank: "6", value: 6 }],
            labels: ["攻撃", "防御"],
          },
          {
            unitId: "soldier-p2-2",
            componentId: "character.soldier",
            kind: "一般兵",
            state: "charge",
            cards: [{ id: "p2-c2", suit: "D", rank: "5", value: 5 }],
            labels: ["攻撃", "防御"],
          },
          {
            unitId: "bw-p2",
            componentId: "character.bulwark",
            kind: "防壁",
            face: "down",
            state: "charge",
            cards: [{ id: "p2-c3", suit: "S", rank: "5", value: 5 }],
            labels: ["防御"],
          },
        ],
        fog: [],
        trump: [],
        grave: [],
      },
    },
    stage: { requests: [], history: [] },
    requestBuffer: { requests: [], history: [] },
  };
}
