import { describe, it, expect } from "vitest";
import { finalizeRequestKeyCards } from "../../engine/rules/CommandRegistry.js";

function createTestContext(overrides?: Partial<any>): any {
  return {
    state: {
      stateVersion: 1,
      players: {
        p1: {
          hand: [],
          field: [],
          grave: [],
          fog: [],
          life: [],
          trumps: [],
          rareCards: [],
          graveTopCardId: undefined,
        },
        p2: {
          hand: [],
          field: [],
          grave: [],
          fog: [],
          life: [],
          trumps: [],
          rareCards: [],
          graveTopCardId: undefined,
        },
      },
      pendingGraveTopSelections: [],
      ...overrides?.state,
    },
    ...overrides,
  };
}

describe("共通キーカード墓地移動処理 単体テスト (KT-01〜KT-10)", () => {
  it("KT-01: 残存キーカード0枚の場合、墓地および墓地TOPを変更せず決定も要求しない", () => {
    const ctx = createTestContext({
      state: {
        stateVersion: 1,
        players: {
          p1: {
            hand: [],
            field: [],
            grave: [{ id: "g-old", suit: "S", rank: "2", value: 2 }],
            fog: [],
            life: [],
            graveTopCardId: "g-old",
          },
          p2: { hand: [], field: [], grave: [], fog: [], life: [] },
        },
        pendingGraveTopSelections: [],
      },
    });
    const req: any = { id: "req-1", actionId: "action.end", controller: "p1", keyCards: [] };
    const res = finalizeRequestKeyCards(req, ctx);

    expect(res.requiresDecision).toBe(false);
    expect(res.movedCount).toBe(0);
    expect(ctx.state.players.p1.grave.length).toBe(1);
    expect(ctx.state.players.p1.graveTopCardId).toBe("g-old");
    expect(ctx.state.pendingGraveTopSelections.length).toBe(0);
  });

  it("KT-02: 残存キーカード1枚の場合、決定不要でそのカードが自動的に墓地TOPになる", () => {
    const logs: any[] = [];
    const ctx = createTestContext({
      logRecorder: { record: (entry: any) => logs.push(entry) },
    });
    const req: any = {
      id: "req-2",
      actionId: "action.twist",
      controller: "p1",
      keyCards: [{ id: "k-1", suit: "D", rank: "6", value: 6 }],
    };
    const res = finalizeRequestKeyCards(req, ctx);

    expect(res.requiresDecision).toBe(false);
    expect(res.movedCount).toBe(1);
    expect(ctx.state.players.p1.grave.map((c: any) => c.id)).toEqual(["k-1"]);
    expect(ctx.state.players.p1.graveTopCardId).toBe("k-1");
    expect(ctx.state.pendingGraveTopSelections.length).toBe(0);
    expect(logs.some((l) => l.type === "zone.top.changed" && l.cardId === "k-1")).toBe(true);
  });

  it("KT-03: 残存キーカード2枚の場合、同時移動し2枚のみがZONE_TOP_SELECTION候補になる", () => {
    const events: any[] = [];
    const mockInterpreter: any = {
      dispatchEvent: (ev: any) => events.push(ev),
    };
    const ctx = createTestContext();
    const req: any = {
      id: "req-3",
      actionId: "action.surprise",
      controller: "p1",
      keyCards: [
        { id: "k-1", suit: "C", rank: "2", value: 2 },
        { id: "k-2", suit: "C", rank: "3", value: 3 },
      ],
    };
    const res = finalizeRequestKeyCards(req, ctx, mockInterpreter);

    expect(res.requiresDecision).toBe(true);
    expect(res.movedCount).toBe(2);
    expect(ctx.state.players.p1.grave.map((c: any) => c.id)).toEqual(["k-1", "k-2"]);
    expect(ctx.state.players.p1.graveTopCardId).toBeUndefined();
    expect(ctx.state.pendingGraveTopSelections.length).toBe(1);
    expect(ctx.state.pendingGraveTopSelections[0].reason).toBe("MULTI_CARD_GRAVE_MOVE");
    expect(ctx.state.pendingGraveTopSelections[0].candidateCardIds).toEqual(["k-1", "k-2"]);
    expect(events.filter((e) => e.type === "cardMoved" && e.payload?.toZone === "grave")).toHaveLength(2);
  });

  it("KT-04: 残存キーカード3枚・5枚の場合、全移動枚数がTOP選択候補に含まれる", () => {
    const ctx = createTestContext();
    const req: any = {
      id: "req-4",
      actionId: "action.rsf",
      controller: "p1",
      keyCards: [
        { id: "k-1", suit: "S", rank: "A", value: 1 },
        { id: "k-2", suit: "S", rank: "10", value: 10 },
        { id: "k-3", suit: "S", rank: "J", value: 11 },
        { id: "k-4", suit: "S", rank: "Q", value: 12 },
        { id: "k-5", suit: "S", rank: "K", value: 13 },
      ],
    };
    const res = finalizeRequestKeyCards(req, ctx);

    expect(res.requiresDecision).toBe(true);
    expect(res.movedCount).toBe(5);
    expect(ctx.state.pendingGraveTopSelections[0].candidateCardIds).toEqual([
      "k-1",
      "k-2",
      "k-3",
      "k-4",
      "k-5",
    ]);
  });

  it("KT-05: 既存墓地カードがある場合でも、新規移動キーカードのみがTOP選択候補になる", () => {
    const ctx = createTestContext({
      state: {
        stateVersion: 1,
        players: {
          p1: {
            hand: [],
            field: [],
            grave: [{ id: "g-old", suit: "H", rank: "9", value: 9 }],
            fog: [],
            life: [],
            graveTopCardId: "g-old",
          },
          p2: { hand: [], field: [], grave: [], fog: [], life: [] },
        },
        pendingGraveTopSelections: [],
      },
    });
    const req: any = {
      id: "req-5",
      actionId: "action.surprise",
      controller: "p1",
      keyCards: [
        { id: "k-1", suit: "C", rank: "2", value: 2 },
        { id: "k-2", suit: "C", rank: "3", value: 3 },
      ],
    };
    const res = finalizeRequestKeyCards(req, ctx);

    expect(res.requiresDecision).toBe(true);
    expect(ctx.state.pendingGraveTopSelections[0].previousTopCardId).toBe("g-old");
    expect(ctx.state.pendingGraveTopSelections[0].candidateCardIds).not.toContain("g-old");
    expect(ctx.state.pendingGraveTopSelections[0].candidateCardIds).toEqual(["k-1", "k-2"]);
  });

  it("KT-06: 一部のキーカードが効果によって他ゾーンへ移動済みの場合、残存カードのみを移動する（残1枚なら選択不要）", () => {
    const ctx = createTestContext({
      state: {
        stateVersion: 1,
        players: {
          p1: {
            hand: [{ id: "k-1", suit: "C", rank: "2", value: 2 }],
            field: [],
            grave: [],
            fog: [],
            life: [],
          },
          p2: { hand: [], field: [], grave: [], fog: [], life: [] },
        },
        pendingGraveTopSelections: [],
      },
    });
    const req: any = {
      id: "req-6",
      actionId: "action.test",
      controller: "p1",
      keyCards: [
        { id: "k-1", suit: "C", rank: "2", value: 2 },
        { id: "k-2", suit: "C", rank: "3", value: 3 },
      ],
    };
    const res = finalizeRequestKeyCards(req, ctx);

    expect(res.requiresDecision).toBe(false);
    expect(res.movedCount).toBe(1);
    expect(ctx.state.players.p1.grave.map((c: any) => c.id)).toEqual(["k-2"]);
    expect(ctx.state.players.p1.graveTopCardId).toBe("k-2");
    expect(ctx.state.pendingGraveTopSelections.length).toBe(0);
  });

  it("KT-07: 全キーカードが効果によって他ゾーン(fog/field/hand/trumps等)へ移動済みの場合、墓地移動しない", () => {
    const ctx = createTestContext({
      state: {
        stateVersion: 1,
        players: {
          p1: {
            hand: [],
            field: [],
            grave: [],
            fog: [
              {
                fogId: "f-1",
                cards: [
                  { id: "k-1", suit: "H", rank: "2", value: 2 },
                  { id: "k-2", suit: "H", rank: "3", value: 3 },
                ],
              },
            ],
            life: [],
          },
          p2: { hand: [], field: [], grave: [], fog: [], life: [] },
        },
        pendingGraveTopSelections: [],
      },
    });
    const req: any = {
      id: "req-7",
      actionId: "action.force",
      controller: "p1",
      keyCards: [
        { id: "k-1", suit: "H", rank: "2", value: 2 },
        { id: "k-2", suit: "H", rank: "3", value: 3 },
      ],
    };
    const res = finalizeRequestKeyCards(req, ctx);

    expect(res.requiresDecision).toBe(false);
    expect(res.movedCount).toBe(0);
    expect(ctx.state.players.p1.grave.length).toBe(0);
    expect(ctx.state.pendingGraveTopSelections.length).toBe(0);
  });

  it("KT-08: keyUnits は共通キーカード墓地移動の対象に含めない(keyCardsのみ対象)", () => {
    const ctx = createTestContext();
    const req: any = {
      id: "req-8",
      actionId: "action.sacrifice",
      controller: "p1",
      keyCards: [{ id: "k-1", suit: "C", rank: "2", value: 2 }],
      keyUnits: [{ unitId: "u-1", cards: [{ id: "u-card-1", suit: "S", rank: "5", value: 5 }] }],
    };
    const res = finalizeRequestKeyCards(req, ctx);

    expect(res.movedCount).toBe(1);
    expect(ctx.state.players.p1.grave.map((c: any) => c.id)).toEqual(["k-1"]);
    expect(ctx.state.players.p1.grave.some((c: any) => c.id === "u-card-1")).toBe(false);
  });

  it("KT-09: 重複した物理カードIDを含む不正リクエストをfail-closedで拒絶し部分移動を起こさない", () => {
    const ctx = createTestContext();
    const req: any = {
      id: "req-9",
      actionId: "action.test",
      controller: "p1",
      keyCards: [
        { id: "k-1", suit: "C", rank: "2", value: 2 },
        { id: "k-1", suit: "C", rank: "2", value: 2 },
      ],
    };
    expect(() => finalizeRequestKeyCards(req, ctx)).toThrow(/重複した物理カードID/);
    expect(ctx.state.players.p1.grave.length).toBe(0);
    expect(ctx.state.pendingGraveTopSelections.length).toBe(0);
  });

  it("KT-10: 不正カード(suit/rank欠落, ID欠落, Unit wrapper混入)を含む場合は事前検証で例外を投げ、先頭カードも含め部分移動を一切起こさない", () => {
    const validCard = { id: "k-valid", suit: "S", rank: "4", value: 4 };

    // 1. suit/rank 欠落カードの混在（1枚目は有効でも部分移動しない）
    const ctxMissingRank = createTestContext();
    const reqMissingRank: any = {
      id: "req-10a",
      actionId: "action.test",
      controller: "p1",
      keyCards: [validCard, { id: "k-invalid-no-suit" }],
    };
    expect(() => finalizeRequestKeyCards(reqMissingRank, ctxMissingRank)).toThrow(/不正なキーカード/);
    expect(ctxMissingRank.state.players.p1.grave).toHaveLength(0);
    expect(ctxMissingRank.state.pendingGraveTopSelections).toHaveLength(0);

    // 2. Unit wrapper 混入
    const ctxWrapper = createTestContext();
    const reqWrapper: any = {
      id: "req-10b",
      actionId: "action.test",
      controller: "p1",
      keyCards: [validCard, { id: "u-wrap", unitId: "u-1", suit: "H", rank: "3", cards: [] }],
    };
    expect(() => finalizeRequestKeyCards(reqWrapper, ctxWrapper)).toThrow(/不正なキーカード/);
    expect(ctxWrapper.state.players.p1.grave).toHaveLength(0);

    // 3. null / 空ID混入
    const ctxEmptyId = createTestContext();
    const reqEmptyId: any = {
      id: "req-10c",
      actionId: "action.test",
      controller: "p1",
      keyCards: [validCard, { id: "  ", suit: "D", rank: "5" }],
    };
    expect(() => finalizeRequestKeyCards(reqEmptyId, ctxEmptyId)).toThrow(/不正なキーカード/);
    expect(ctxEmptyId.state.players.p1.grave).toHaveLength(0);
  });
});
