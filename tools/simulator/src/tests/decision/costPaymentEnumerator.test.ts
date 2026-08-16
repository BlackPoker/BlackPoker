import { describe, it, expect } from "vitest";
import { CostPaymentEnumerator } from "../../engine/decision/CostPaymentEnumerator";

describe("CostPaymentEnumerator Tests", () => {
  it("should enumerate discard options excluding key cards", () => {
    const player = {
      hand: [
        { id: "c1", suit: "H", rank: "7" },
        { id: "c2", suit: "C", rank: "2" },
        { id: "c3", suit: "D", rank: "3" },
      ],
      field: [],
      life: 10,
    };

    // c1 がキーカードとして除外される場合、捨て札候補は c2, c3 の 2 通り
    const excluded = new Set(["c1"]);
    const payments = CostPaymentEnumerator.enumeratePayments("D", player, excluded);

    expect(payments.length).toBe(2);
    expect(payments.map((p) => p.discardedCardIds)).toEqual([["c2"], ["c3"]]);
  });

  it("should enumerate bulwark drive options", () => {
    const player = {
      hand: [],
      field: [
        { unitId: "bulwark-1", kind: "防壁", state: "charge" },
        { unitId: "bulwark-2", kind: "防壁", state: "charge" },
        { unitId: "bulwark-3", kind: "防壁", state: "drive" }, // ドライブ状態は除外
      ],
      life: 10,
    };

    const payments = CostPaymentEnumerator.enumeratePayments("B", player);

    expect(payments.length).toBe(2);
    expect(payments.map((p) => p.drivenBulwarkUnitIds)).toEqual([["bulwark-1"], ["bulwark-2"]]);
  });

  it("should enumerate composite costs (D+B)", () => {
    const player = {
      hand: [
        { id: "c1", suit: "H", rank: "7" },
        { id: "c2", suit: "C", rank: "2" },
      ],
      field: [
        { unitId: "bulwark-1", kind: "防壁", state: "charge" },
        { unitId: "bulwark-2", kind: "防壁", state: "charge" },
      ],
      life: 10,
    };

    const excluded = new Set(["c1"]); // c1 をキーカード除外
    const payments = CostPaymentEnumerator.enumeratePayments("D+B", player, excluded);

    // 手札 1 通り (c2) × 防壁 2 通り = 2 通り
    expect(payments.length).toBe(2);
    expect(payments[0].discardedCardIds).toEqual(["c2"]);
    expect(payments[0].drivenBulwarkUnitIds).toEqual(["bulwark-1"]);
    expect(payments[1].discardedCardIds).toEqual(["c2"]);
    expect(payments[1].drivenBulwarkUnitIds).toEqual(["bulwark-2"]);
  });

  it("should return empty array when resources are insufficient", () => {
    const player = {
      hand: [{ id: "c1" }],
      field: [],
      life: 10,
    };

    const excluded = new Set(["c1"]); // 手札の1枚がキーカードなので捨て札不足
    const payments = CostPaymentEnumerator.enumeratePayments("D", player, excluded);

    expect(payments.length).toBe(0);
  });
});
