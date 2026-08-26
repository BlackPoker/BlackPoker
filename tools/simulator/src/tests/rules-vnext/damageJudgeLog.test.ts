import { describe, it, expect } from "vitest";
import { GameEventFormatter } from "../../engine/session/playtest/GameEventFormatter";

describe("DamageJudge Detailed Log Formatter Tests (Phase 21B.6)", () => {
  it("P0-2: should format soldier vs multiple soldiers combat log correctly", () => {
    const prevState = {
      turnPlayer: "p1",
      turnCount: 1,
      players: {
        p1: { name: "Player A", field: [], hand: [], grave: [], life: 10 },
        p2: { name: "Player B", field: [], hand: [], grave: [], life: 10 },
      },
      stage: { history: [] },
    };

    const nextState = {
      turnPlayer: "p1",
      turnCount: 1,
      players: {
        p1: { name: "Player A", field: [], hand: [], grave: [], life: 10 },
        p2: { name: "Player B", field: [], hand: [], grave: [], life: 10 },
      },
      stage: {
        history: [
          {
            actionId: "action.damageJudge",
            action: { name: "ダメージ判定" },
            controller: "p1",
            result: {
              damageJudge: {
                combats: [
                  {
                    attackerUnitId: "atk-1",
                    attackerPlayerKey: "p1",
                    combatType: "soldierVsSoldiers",
                    blockerUnitIds: ["blk-1", "blk-2"],
                    blockerPlayerKey: "p2",
                    attackerInitialSize: 6,
                    blockerInitialTotalSize: 11,
                    attackerMovedToGrave: true,
                    blockersMovedToGrave: [],
                    attackerCardCode: "S6",
                    blockerCardCodes: ["C6", "D5"],
                  },
                ],
              },
            },
          },
        ],
      },
    };

    const logs = GameEventFormatter.formatStateTransition(prevState, nextState);
    const messages = logs.map((l) => l.message);

    expect(messages.some((m) => m.includes("Player A の一般兵 [♠6] vs Player B の一般兵 [♣6] + Player B の一般兵 [♢5]"))).toBe(true);
    expect(messages.some((m) => m.includes("サイズ比較: attacker 6 vs blockers 11"))).toBe(true);
    expect(messages.some((m) => m.includes("アタッカー死亡 / ブロッカー生存"))).toBe(true);
  });

  it("P0-2: should format soldier vs bulwark combat log with printed rank match", () => {
    const prevState = {
      turnPlayer: "p1",
      turnCount: 1,
      players: {
        p1: { name: "Player A", field: [], hand: [], grave: [], life: 10 },
        p2: { name: "Player B", field: [], hand: [], grave: [], life: 10 },
      },
      stage: { history: [] },
    };

    const nextState = {
      turnPlayer: "p1",
      turnCount: 1,
      players: {
        p1: { name: "Player A", field: [], hand: [], grave: [], life: 10 },
        p2: { name: "Player B", field: [], hand: [], grave: [], life: 10 },
      },
      stage: {
        history: [
          {
            actionId: "action.damageJudge",
            action: { name: "ダメージ判定" },
            controller: "p1",
            result: {
              damageJudge: {
                combats: [
                  {
                    attackerUnitId: "atk-1",
                    attackerPlayerKey: "p1",
                    combatType: "soldierVsBulwark",
                    blockerUnitIds: ["bw-1"],
                    blockerPlayerKey: "p2",
                    attackerInitialSize: 5,
                    attackerMovedToGrave: true,
                    blockersMovedToGrave: ["bw-1"],
                    bulwarkRevealed: true,
                    bulwarkMatched: true,
                    bulwarkRank: "5",
                    attackerCardCode: "H5",
                    blockerCardCodes: ["H5"],
                  },
                ],
              },
            },
          },
        ],
      },
    };

    const logs = GameEventFormatter.formatStateTransition(prevState, nextState);
    const messages = logs.map((l) => l.message);

    expect(messages.some((m) => m.includes("Player A の一般兵 [♡5] vs Player B の防壁 [♡5]"))).toBe(true);
    expect(messages.some((m) => m.includes("防壁判定: printed rank 5 一致"))).toBe(true);
    expect(messages.some((m) => m.includes("アタッカー死亡 / 防壁死亡"))).toBe(true);
  });
});
