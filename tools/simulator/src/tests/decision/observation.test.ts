import { describe, it, expect } from "vitest";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";

describe("ObservationFactory Non-Public Information Tests (16.6)", () => {
  it("should hide opponent hand details and expose viewer hand details", () => {
    const state = {
      players: {
        p1: {
          name: "Player A",
          life: 16,
          hand: [
            { id: "h1", suit: "H", rank: "7", value: 7 },
            { id: "h2", suit: "C", rank: "2", value: 2 },
          ],
          field: [],
          fog: [],
          grave: [],
        },
        p2: {
          name: "Player B",
          life: 16,
          hand: [
            { id: "secret-1", suit: "S", rank: "A", value: 1 },
            { id: "secret-2", suit: "D", rank: "K", value: 13 },
            { id: "secret-3", suit: "H", rank: "Q", value: 12 },
          ],
          field: [],
          fog: [],
          grave: [],
        },
      },
      stage: { requests: [] },
    };

    // p1 視点の Observation を生成
    const obsP1 = ObservationFactory.createObservation(state, "p1");

    const p1View = obsP1.players.find((p) => p.playerId === "p1")!;
    const p2View = obsP1.players.find((p) => p.playerId === "p2")!;

    // 1. 自分の手札は KNOWN で詳細が取得できる
    expect(p1View.handCount).toBe(2);
    expect(p1View.handCards.length).toBe(2);
    expect(p1View.handCards[0].visibility).toBe("KNOWN");
    if (p1View.handCards[0].visibility === "KNOWN") {
      expect(p1View.handCards[0].suit).toBe("H");
      expect(p1View.handCards[0].rank).toBe("7");
    }

    // 2. 相手の手札は HIDDEN であり、suit や rank などの詳細情報は漏洩しない
    expect(p2View.handCount).toBe(3);
    expect(p2View.handCards.length).toBe(3);
    for (const card of p2View.handCards) {
      expect(card.visibility).toBe("HIDDEN");
      expect((card as any).suit).toBeUndefined();
      expect((card as any).rank).toBeUndefined();
      expect((card as any).value).toBeUndefined();
    }
  });
});
