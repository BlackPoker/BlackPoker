import { describe, it, expect } from "vitest";
import {
  ChallengeDefinitionV1,
  CHALLENGE_SCHEMA_VERSION,
} from "../../domain/challenge/ChallengeDefinition";
import {
  ChallengeEvaluator,
  ChallengeRuntimeState,
} from "../../engine/challenge/ChallengeEvaluator";
import { GameSessionStep } from "../../engine/session/GameSession";

describe("ChallengeEvaluator Unit Tests (BP-SIM-CHALLENGE-1.0-WIN-CURRENT-TURN)", () => {
  const challengeDef: ChallengeDefinitionV1 = {
    version: CHALLENGE_SCHEMA_VERSION,
    kind: "WIN_CURRENT_TURN",
  };

  it("Test A: initial state: turnPlayer=p1, turnCount=1 -> ACTIVE, challenger=p1", () => {
    const state = { turnPlayer: "p1", turnCount: 1 };
    const runtime = ChallengeEvaluator.initialize(challengeDef, state);

    expect(runtime.status).toBe("ACTIVE");
    expect(runtime.challenger).toBe("p1");
    expect(runtime.initialTurnPlayer).toBe("p1");
    expect(runtime.initialTurnCount).toBe(1);
    expect(runtime.definition).toEqual(challengeDef);
    expect(runtime.reason).toBeUndefined();
  });

  it("Test A2: initial state: turnPlayer=p2, turnCount=3 -> ACTIVE, challenger=p2", () => {
    const state = { turnPlayer: "p2", turnCount: 3 };
    const runtime = ChallengeEvaluator.initialize(challengeDef, state);

    expect(runtime.status).toBe("ACTIVE");
    expect(runtime.challenger).toBe("p2");
    expect(runtime.initialTurnPlayer).toBe("p2");
    expect(runtime.initialTurnCount).toBe(3);
  });

  it("Test B: FINISHED winner=p1 within deadline -> CLEARED (WIN_BEFORE_DEADLINE)", () => {
    const runtime = ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p1", turnCount: 1 });
    const finishedStep: GameSessionStep = {
      type: "FINISHED",
      result: { winner: "p1", reason: "Player B のライフが0になりました" },
    };
    const currentState = { turnPlayer: "p1", turnCount: 1 };

    const evaluated = ChallengeEvaluator.evaluate(runtime, finishedStep, currentState);
    expect(evaluated.status).toBe("CLEARED");
    expect(evaluated.reason).toBe("WIN_BEFORE_DEADLINE");
    expect(evaluated.challenger).toBe("p1");
  });

  it("Test C: FINISHED winner=p2 before deadline -> FAILED (OPPONENT_WON)", () => {
    const runtime = ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p1", turnCount: 1 });
    const finishedStep: GameSessionStep = {
      type: "FINISHED",
      result: { winner: "p2", reason: "Player A のライフが0になりました" },
    };
    const currentState = { turnPlayer: "p1", turnCount: 1 };

    const evaluated = ChallengeEvaluator.evaluate(runtime, finishedStep, currentState);
    expect(evaluated.status).toBe("FAILED");
    expect(evaluated.reason).toBe("OPPONENT_WON");
  });

  it("Test D: turnPlayer=p2, turnCount=2 not FINISHED -> FAILED (TURN_ENDED_BEFORE_WIN)", () => {
    const runtime = ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p1", turnCount: 1 });
    const waitingStep: GameSessionStep = {
      type: "WAITING_FOR_DECISION",
      request: {
        decisionId: "dec-1",
        stateVersion: 2,
        playerId: "p2",
        patterns: [],
      } as any,
    };
    const nextTurnState = { turnPlayer: "p2", turnCount: 2 };

    const evaluated = ChallengeEvaluator.evaluate(runtime, waitingStep, nextTurnState);
    expect(evaluated.status).toBe("FAILED");
    expect(evaluated.reason).toBe("TURN_ENDED_BEFORE_WIN");
  });

  it("Test D2: turnPlayer=p1, turnCount=2 (same player next turn) -> deadline crossed -> FAILED", () => {
    const runtime = ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p1", turnCount: 1 });
    const progressedStep: GameSessionStep = { type: "PROGRESSED" };
    const nextTurnState = { turnPlayer: "p1", turnCount: 2 };

    const evaluated = ChallengeEvaluator.evaluate(runtime, progressedStep, nextTurnState);
    expect(evaluated.status).toBe("FAILED");
    expect(evaluated.reason).toBe("TURN_ENDED_BEFORE_WIN");
  });

  it("Test E: deadline crossed後 FINISHED winner=p1 -> FAILED", () => {
    const runtime = ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p1", turnCount: 1 });
    const finishedStep: GameSessionStep = {
      type: "FINISHED",
      result: { winner: "p1", reason: "Player B のライフが0になりました" },
    };
    // ターンが 2 に進んだ後に勝利した場合
    const crossedState = { turnPlayer: "p1", turnCount: 2 };

    const evaluated = ChallengeEvaluator.evaluate(runtime, finishedStep, crossedState);
    expect(evaluated.status).toBe("FAILED");
    expect(evaluated.reason).toBe("TURN_ENDED_BEFORE_WIN");
  });

  it("Test F: CLEARED再評価 -> CLEARED維持 (Terminal状態は不可逆)", () => {
    const runtime = ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p1", turnCount: 1 });
    const cleared = ChallengeEvaluator.evaluate(
      runtime,
      { type: "FINISHED", result: { winner: "p1", reason: "Cleared" } },
      { turnPlayer: "p1", turnCount: 1 }
    );
    expect(cleared.status).toBe("CLEARED");

    // ターンが進んだ別状態を再入力しても CLEARED が維持されること
    const reEvaluated = ChallengeEvaluator.evaluate(
      cleared,
      { type: "PROGRESSED" },
      { turnPlayer: "p2", turnCount: 2 }
    );
    expect(reEvaluated.status).toBe("CLEARED");
    expect(reEvaluated.reason).toBe("WIN_BEFORE_DEADLINE");
  });

  it("Test G: FAILED再評価 -> FAILED維持 (Terminal状態は不可逆)", () => {
    const runtime = ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p1", turnCount: 1 });
    const failed = ChallengeEvaluator.evaluate(
      runtime,
      { type: "PROGRESSED" },
      { turnPlayer: "p2", turnCount: 2 }
    );
    expect(failed.status).toBe("FAILED");

    // その後 winner=p1 の FINISHED が来ても FAILED が維持されること
    const reEvaluated = ChallengeEvaluator.evaluate(
      failed,
      { type: "FINISHED", result: { winner: "p1", reason: "Late win" } },
      { turnPlayer: "p1", turnCount: 3 }
    );
    expect(reEvaluated.status).toBe("FAILED");
    expect(reEvaluated.reason).toBe("TURN_ENDED_BEFORE_WIN");
  });

  it("Test H: invalid initialization -> fail-closed (例外送出)", () => {
    // 1. 不正な definition
    expect(() =>
      ChallengeEvaluator.initialize({ version: 99, kind: "WIN_CURRENT_TURN" } as any, {
        turnPlayer: "p1",
        turnCount: 1,
      })
    ).toThrow();

    expect(() =>
      ChallengeEvaluator.initialize({ version: 1, kind: "UNKNOWN_KIND" } as any, {
        turnPlayer: "p1",
        turnCount: 1,
      })
    ).toThrow();

    // 2. 不正な turnPlayer
    expect(() =>
      ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p3", turnCount: 1 } as any)
    ).toThrow();

    expect(() =>
      ChallengeEvaluator.initialize(challengeDef, { turnPlayer: undefined, turnCount: 1 } as any)
    ).toThrow();

    // 3. 不正な turnCount
    expect(() =>
      ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p1", turnCount: 0 } as any)
    ).toThrow();

    expect(() =>
      ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p1", turnCount: -1 } as any)
    ).toThrow();

    expect(() =>
      ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p1", turnCount: NaN } as any)
    ).toThrow();

    expect(() =>
      ChallengeEvaluator.initialize(challengeDef, { turnPlayer: "p1", turnCount: 1.5 } as any)
    ).toThrow();
  });

  it("Test I: GameResult との分離性 (state や step を改変しないこと)", () => {
    const state = { turnPlayer: "p1", turnCount: 1, players: { p1: { life: 5 }, p2: { life: 5 } } };
    const runtime = ChallengeEvaluator.initialize(challengeDef, state);

    const step: GameSessionStep = { type: "PROGRESSED" };
    const stateAfterEnd = { turnPlayer: "p2", turnCount: 2, players: { p1: { life: 5 }, p2: { life: 5 } } };

    const evaluated = ChallengeEvaluator.evaluate(runtime, step, stateAfterEnd);
    expect(evaluated.status).toBe("FAILED");

    // 入力 step や state が一切改変されていないこと
    expect(step.type).toBe("PROGRESSED");
    expect(stateAfterEnd.players.p1.life).toBe(5);
    expect(stateAfterEnd.players.p2.life).toBe(5);
  });
});
