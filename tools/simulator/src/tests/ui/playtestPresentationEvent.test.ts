import { describe, it, expect } from "vitest";
import { ViewerAwareGameEventFormatter } from "../../engine/session/playtest/ViewerAwareGameEventFormatter";
import { createDeterministicPresentationEventId } from "../../engine/session/playtest/PlaytestPresentationEvent";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";

describe("Playtest Presentation Event & Format Tests", () => {
  it("createDeterministicPresentationEventId: stateVersion, index, kind から決定論的なIDを生成すること (Date.now/Math.random不使用)", () => {
    const id1 = createDeterministicPresentationEventId(5, 0, "ACTION_RESOLVED");
    const id2 = createDeterministicPresentationEventId(5, 1, "UNIT_STATE_CHANGED");
    expect(id1).toBe("v5-0-ACTION_RESOLVED");
    expect(id2).toBe("v5-1-UNIT_STATE_CHANGED");
  });

  describe("E-1: キャンセル済みリクエストの表示 [CANCELLED]", () => {
    it("status === 'cancelled' のリクエスト解決時は [RESOLVE] ではなく [CANCELLED] として発行されること", () => {
      const prevState = createCoreBattlePresetState();
      prevState.stage.requests = [
        {
          id: "req-1",
          actionId: "action.attack",
          controller: "p1",
          action: { id: "action.attack", name: "攻撃" },
        },
      ];
      prevState.stage.history = [];

      const nextState = JSON.parse(JSON.stringify(prevState));
      nextState.stage.requests = [];
      nextState.stage.history = [
        {
          id: "req-1",
          actionId: "action.attack",
          controller: "p1",
          action: { id: "action.attack", name: "攻撃" },
          status: "cancelled",
          cancelReason: "countered",
        },
      ];

      const events = ViewerAwareGameEventFormatter.formatStateTransition(prevState, nextState);
      const cancelEvents = events.filter((e) => e.kind === "REQUEST_CANCELLED");
      const resolveEvents = events.filter((e) => e.kind === "ACTION_RESOLVED");

      expect(cancelEvents.length).toBe(1);
      expect(resolveEvents.length).toBe(0);
      expect(cancelEvents[0].message).toContain("[CANCELLED]");
      expect(cancelEvents[0].message).toContain("無効化されました");
      expect(cancelEvents[0].message).not.toContain("[RESOLVE]");
    });
  });

  describe("E-2: ダメージ表記の汎用化と重複解消", () => {
    it("未ブロック攻撃解決時、算出ダメージと実適用ダメージを明瞭に表示し、重複する[DAMAGE]イベントを発行しないこと", () => {
      const prevState = createCoreBattlePresetState();
      prevState.players.p2.life = Array(5).fill({ id: "l-p2", suit: "S", rank: 1 }); // 残り5
      prevState.stage.requests = [
        {
          id: "req-judge",
          actionId: "action.damageJudge",
          controller: "p1",
          action: { id: "action.damageJudge", name: "ダメージ判定" },
        },
      ];

      const nextState = JSON.parse(JSON.stringify(prevState));
      nextState.players.p2.life = []; // 5ダメージ適用で0に
      nextState.stage.requests = [];
      nextState.stage.history = [
        {
          id: "req-judge",
          actionId: "action.damageJudge",
          controller: "p1",
          action: { id: "action.damageJudge", name: "ダメージ判定" },
          result: {
            damageJudge: {
              combats: [
                {
                  attackerUnitId: "u-atk",
                  attackerPlayerKey: "p1",
                  combatType: "unblocked",
                  attackerInitialSize: 13,
                  attackerCardCode: "S10+S3",
                  targetPlayerKey: "p2",
                  directDamageAmount: 13,
                },
              ],
            },
          },
        },
      ];

      const events = ViewerAwareGameEventFormatter.formatStateTransition(prevState, nextState);
      const damageEvents = events.filter((e) => e.kind === "DAMAGE");

      // 重複 DAMAGE は解消され、単一の DAMAGE イベントであること
      expect(damageEvents.length).toBe(1);
      // 算出ダメージ: 13 / 実適用: 5 が含まれること
      expect(damageEvents[0].message).toContain("算出ダメージ: 13 / 実適用: 5");
      expect(damageEvents[0].damageAmount).toBe(5);
      expect(damageEvents[0].calculatedDamage).toBe(13);

      // DAMAGE_JUDGE イベントには未ブロックの攻撃サイズが記録されること
      const judgeEvents = events.filter((e) => e.kind === "DAMAGE_JUDGE");
      expect(judgeEvents.length).toBe(1);
      expect(judgeEvents[0].message).toContain("攻撃サイズ: 13");
    });
  });

  describe("E-4: ユニット表示セマンティクス (#esetの排除)", () => {
    it("ユニット状態変化時に #eset などの末尾スライス識別子が表示されず、プレイヤー名と種別が明瞭に表示されること", () => {
      const prevState = createCoreBattlePresetState();
      // unitId が preset で終わるユニット
      prevState.players.p1.field = [
        {
          unitId: "unit-p1-hero-preset",
          kind: "英雄",
          state: "charge",
          cards: [{ suit: "S", rank: 1 }],
        },
      ];

      const nextState = JSON.parse(JSON.stringify(prevState));
      nextState.players.p1.field[0].state = "drive";

      const events = ViewerAwareGameEventFormatter.formatStateTransition(prevState, nextState);
      const stateEvents = events.filter((e) => e.kind === "UNIT_STATE_CHANGED");

      expect(stateEvents.length).toBe(1);
      expect(stateEvents[0].message).not.toContain("#eset");
      expect(stateEvents[0].message).toContain("Player A の 英雄 が charge → drive に切り替わりました");
      expect(stateEvents[0].unitLabel).toBe("Player A の 英雄");
    });

    it("ユニット墓地送り時に #eset が表示されないこと", () => {
      const prevState = createCoreBattlePresetState();
      prevState.players.p2.field = [
        {
          unitId: "unit-p2-bulwark-preset",
          kind: "防壁",
          state: "charge",
          cards: [{ suit: "D", rank: 5 }],
        },
      ];
      prevState.players.p2.grave = [];

      const nextState = JSON.parse(JSON.stringify(prevState));
      nextState.players.p2.field = [];
      nextState.players.p2.grave = [
        {
          unitId: "unit-p2-bulwark-preset",
          kind: "防壁",
          cards: [{ suit: "D", rank: 5 }],
        },
      ];

      const events = ViewerAwareGameEventFormatter.formatStateTransition(prevState, nextState);
      const defeatEvents = events.filter((e) => e.kind === "UNIT_DEFEATED");

      expect(defeatEvents.length).toBe(1);
      expect(defeatEvents[0].message).not.toContain("#eset");
      expect(defeatEvents[0].message).toContain("Player B の 防壁① が墓地へ送られました");
    });
  });

  describe("C & 汎用因果関係: Action ID 非依存性およびターゲット情報の汎用抽出", () => {
    it("actionId が action.damageJudge 以外の名称であっても、result.damageJudge.combats の存在により正常に戦闘ログが発行されること (Action ID 非依存)", () => {
      const prevState = createCoreBattlePresetState();
      prevState.stage.requests = [];
      prevState.stage.history = [];

      const nextState = JSON.parse(JSON.stringify(prevState));
      // actionId が action.damageJudge ではないカスタム名称
      nextState.stage.history = [
        {
          id: "req-custom-combat-1",
          actionId: "custom.combatResolveAction",
          controller: "p1",
          action: { id: "custom.combatResolveAction", name: "戦闘解決" },
          result: {
            damageJudge: {
              combats: [
                {
                  attackerUnitId: "u-atk",
                  attackerPlayerKey: "p1",
                  combatType: "unblocked",
                  attackerInitialSize: 5,
                  attackerCardCode: "S5",
                  targetPlayerKey: "p2",
                  directDamageAmount: 5,
                },
              ],
            },
          },
        },
      ];

      const events = ViewerAwareGameEventFormatter.formatStateTransition(prevState, nextState);
      const judgeEvents = events.filter((e) => e.kind === "DAMAGE_JUDGE");
      expect(judgeEvents.length).toBe(1);
      expect(judgeEvents[0].message).toContain("未ブロック (攻撃サイズ: 5)");
    });

    it("res.targets から汎用的に targetRequestId および targetUnitId が ACTION_RESOLVED / UNIT_STATE_CHANGED に抽出・紐付けされること", () => {
      const prevState = createCoreBattlePresetState();
      prevState.players.p1.field = [
        {
          unitId: "unit-hero-target",
          kind: "英雄",
          state: "charge",
          cards: [{ suit: "S", rank: 1 }],
        },
      ];
      prevState.stage.requests = [];
      prevState.stage.history = [];

      const nextState = JSON.parse(JSON.stringify(prevState));
      nextState.players.p1.field[0].state = "drive";
      nextState.stage.history = [
        {
          id: "req-action-unit",
          actionId: "action.customTwist",
          controller: "p1",
          action: { id: "action.customTwist", name: "カスタムツイスト" },
          targets: [
            {
              type: "unit",
              unitId: "unit-hero-target",
            },
          ],
        },
        {
          id: "req-action-req",
          actionId: "action.customCounter",
          controller: "p2",
          action: { id: "action.customCounter", name: "カスタムカウンター" },
          targets: [
            {
              type: "request",
              requestId: "req-target-42",
            },
          ],
        },
      ];

      const events = ViewerAwareGameEventFormatter.formatStateTransition(prevState, nextState);

      const resolveEvents = events.filter((e) => e.kind === "ACTION_RESOLVED");
      expect(resolveEvents.length).toBe(2);

      const unitAction = resolveEvents.find((e) => e.requestId === "req-action-unit");
      expect(unitAction).toBeDefined();
      expect(unitAction!.targetUnitId).toBe("unit-hero-target");

      const reqAction = resolveEvents.find((e) => e.requestId === "req-action-req");
      expect(reqAction).toBeDefined();
      expect(reqAction!.targetRequestId).toBe("req-target-42");

      // UNIT_STATE_CHANGED には、ちょうど1件合致した unitAction の ID が sourceRequestId として紐付くこと
      const stateEvents = events.filter((e) => e.kind === "UNIT_STATE_CHANGED");
      expect(stateEvents.length).toBe(1);
      expect(stateEvents[0].sourceRequestId).toBe("req-action-unit");
    });
  });
});
