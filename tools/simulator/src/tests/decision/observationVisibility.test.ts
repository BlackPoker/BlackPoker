import { describe, it, expect } from "vitest";
import { ObservationFactory } from "../../engine/decision/ObservationFactory";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";

describe("Observation Visibility & Owner-Aware Concealment Tests (Phase 21B.4)", () => {
  it("when viewer is p1, p1's face-down bulwark is KNOWN with card info, while p2's bulwark is HIDDEN", () => {
    const state = createCoreBattlePresetState();

    const obs = ObservationFactory.createObservation(state, "p1");

    const p1Obs = obs.players.find((p) => p.playerId === "p1")!;
    const p2Obs = obs.players.find((p) => p.playerId === "p2")!;

    // 1. p1 の裏向き防壁 (bw-p1: ♢4)
    const p1Bulwark = p1Obs.field.find((u) => u.unitId === "bw-p1")!;
    expect(p1Bulwark.face).toBe("down");
    expect(p1Bulwark.cards.length).toBe(1);
    const p1Card = p1Bulwark.cards[0] as any;
    expect(p1Card.visibility).toBe("KNOWN");
    expect(p1Card.faceUp).toBe(false);
    expect(p1Card.suit).toBe("D");
    expect(p1Card.rank).toBe("4");
    expect(p1Card.value).toBe(4);

    // 2. p2 の裏向き防壁 (bw-p2: ♡5) -> 相手視点では HIDDEN
    const p2Bulwark = p2Obs.field.find((u) => u.unitId === "bw-p2")!;
    expect(p2Bulwark.face).toBe("down");
    expect(p2Bulwark.cards.length).toBe(1);
    const p2Card = p2Bulwark.cards[0] as any;
    expect(p2Card.visibility).toBe("HIDDEN");
    expect(p2Card.faceUp).toBe(false);
    expect(p2Card.suit).toBeUndefined();
    expect(p2Card.rank).toBeUndefined();
    expect(p2Card.value).toBeUndefined();

    // 3. 手札の非公開性
    expect(p1Obs.handCards[0].visibility).toBe("KNOWN");
    expect(p2Obs.handCards[0].visibility).toBe("HIDDEN");
  });

  it("when viewer is p2, p2's face-down bulwark is KNOWN with card info, while p1's bulwark is HIDDEN", () => {
    const state = createCoreBattlePresetState();

    const obs = ObservationFactory.createObservation(state, "p2");

    const p1Obs = obs.players.find((p) => p.playerId === "p1")!;
    const p2Obs = obs.players.find((p) => p.playerId === "p2")!;

    // 1. p2 の裏向き防壁 (bw-p2: ♡5)
    const p2Bulwark = p2Obs.field.find((u) => u.unitId === "bw-p2")!;
    const p2Card = p2Bulwark.cards[0] as any;
    expect(p2Card.visibility).toBe("KNOWN");
    expect(p2Card.suit).toBe("H");
    expect(p2Card.rank).toBe("5");

    // 2. p1 の裏向き防壁 (bw-p1) -> 相手視点では HIDDEN
    const p1Bulwark = p1Obs.field.find((u) => u.unitId === "bw-p1")!;
    const p1Card = p1Bulwark.cards[0] as any;
    expect(p1Card.visibility).toBe("HIDDEN");
    expect(p1Card.suit).toBeUndefined();
  });
});
