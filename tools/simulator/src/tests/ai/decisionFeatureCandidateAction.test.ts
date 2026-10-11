import { describe, it, expect } from "vitest";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder";
import { GenomeScorer } from "../../engine/ai/GenomeScorer";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec";
import { StableIdentityEncoder } from "../../engine/ai/StableIdentityEncoder";
import {
  CONTEXT_FEATURE_NAMES,
  PATTERN_FEATURE_NAMES,
} from "../../domain/ai/DecisionFeatureTypes";

describe("Candidate Action Stable Identity & Scorer Proof (Feature Schema v4)", () => {
  /**
   * 同一の speed, timing, cost, target structure, key-card を持つ 2 つの Action 候補 (alpha vs beta)
   * および PASS を含む Action Request を生成
   */
  const createSyntheticActionDecisionRequest = (): DecisionRequest => {
    return {
      protocolVersion: "1.0.0",
      matchId: "match-candidate-action-test",
      decisionId: "dec-candidate-action-001",
      stateVersion: 1,
      playerId: "p1",
      source: {
        type: "ACTION_REQUEST",
        playerId: "p1",
      },
      observation: {
        viewerPlayerId: "p1",
        turnPlayerId: "p1",
        chancePlayerId: "p1",
        turnCount: 2,
        players: [
          {
            playerId: "p1",
            name: "Alice",
            isViewer: true,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 3,
            handCards: [
              {
                visibility: "KNOWN",
                cardInstanceId: "c-key-1",
                suit: "S",
                rank: "A",
                value: 1,
                faceUp: true,
                code: "SA",
              },
            ],
            field: [
              {
                unitId: "u-unit-1",
                kind: "soldier",
                componentId: "character.soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 4,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: true,
          },
          {
            playerId: "p2",
            name: "Bob",
            isViewer: false,
            lifeCount: 10,
            lifeDisplay: "10",
            handCount: 3,
            handCards: [],
            field: [
              {
                unitId: "u-opp-1",
                kind: "soldier",
                componentId: "character.soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 3,
              },
            ],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: false,
          },
        ],
        stageRequestRefs: [],
        stageRequests: [],
        recentEvents: [],
      },
      catalog: {
        actions: [
          {
            actionId: "action.synthetic.alpha",
            actionName: "Alpha",
            speed: "normal",
            timing: "main",
          },
          {
            actionId: "action.synthetic.beta",
            actionName: "Beta",
            speed: "normal",
            timing: "main",
          },
        ],
        cardSelections: [
          {
            cardIds: ["c-key-1"],
            displayCodes: ["SA"],
          },
        ],
        unitSelections: [
          {
            unitIds: ["u-unit-1"],
            displayNames: ["Unit 1"],
          },
        ],
        costPayments: [
          {
            discardedCardIds: ["c-key-1"],
            drivenBulwarkUnitIds: [],
            sacrificedUnitIds: [],
            lifeCount: 0,
          },
        ],
        targetSelections: [
          {
            targetType: "unit",
            targetUnitId: "u-opp-1",
            targetPlayerKey: "p2",
          },
        ],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        {
          patternId: "pat-action-alpha",
          kind: "ACTION",
          actionSelectionRef: 0, // alpha
          keyCardSelectionRef: 0,
          keyUnitSelectionRef: 0,
          costPaymentRef: 0,
          targetSelectionRef: 0,
        },
        {
          patternId: "pat-action-beta",
          kind: "ACTION",
          actionSelectionRef: 1, // beta
          keyCardSelectionRef: 0,
          keyUnitSelectionRef: 0,
          costPaymentRef: 0,
          targetSelectionRef: 0,
        },
        {
          patternId: "pat-pass",
          kind: "PASS",
        },
      ],
    };
  };

  it("1. encodes Candidate Action Stable Identity for ACTION patterns and all-zeros for PASS", () => {
    const req = createSyntheticActionDecisionRequest();
    const encoded = DecisionFeatureEncoder.encode(req);

    expect(encoded.patterns.length).toBe(3);

    const alphaBuckets = StableIdentityEncoder.encodeActionIdentity("action.synthetic.alpha");
    const betaBuckets = StableIdentityEncoder.encodeActionIdentity("action.synthetic.beta");

    // alpha と beta の Candidate Action Identity は異なる
    expect(alphaBuckets).not.toEqual(betaBuckets);

    // alpha pattern (Ref 0)
    const patAlphaValues = encoded.patterns[0].values;
    for (let b = 0; b < 16; b++) {
      const idx = PATTERN_FEATURE_NAMES.indexOf(`candidate_action_bucket_${b}` as any);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(patAlphaValues[idx]).toBe(alphaBuckets[b]);
    }

    // beta pattern (Ref 1)
    const patBetaValues = encoded.patterns[1].values;
    for (let b = 0; b < 16; b++) {
      const idx = PATTERN_FEATURE_NAMES.indexOf(`candidate_action_bucket_${b}` as any);
      expect(patBetaValues[idx]).toBe(betaBuckets[b]);
    }

    // PASS pattern (Ref 2) は candidate_action_bucket が全て 0
    const patPassValues = encoded.patterns[2].values;
    for (let b = 0; b < 16; b++) {
      const idx = PATTERN_FEATURE_NAMES.indexOf(`candidate_action_bucket_${b}` as any);
      expect(patPassValues[idx]).toBe(0);
    }
  });

  it("2. isolates Candidate Action Identity: all other Pattern features are identical between alpha and beta", () => {
    const req = createSyntheticActionDecisionRequest();
    const encoded = DecisionFeatureEncoder.encode(req);

    const patAlphaValues = encoded.patterns[0].values;
    const patBetaValues = encoded.patterns[1].values;

    for (let i = 0; i < PATTERN_FEATURE_NAMES.length; i++) {
      const name = PATTERN_FEATURE_NAMES[i];
      if (name.startsWith("candidate_action_bucket_")) {
        // candidate_action_bucket は異なる
        continue;
      }
      // それ以外のメタデータ (speed, timing, cost, keyCard, keyUnit, target 等) は完全に同一
      expect(patAlphaValues[i]).toBe(patBetaValues[i]);
    }
  });

  it("3. Scorer-Level Proof: Genome learns both alpha > beta and beta > alpha via Context x Candidate Action Interaction", () => {
    const req = createSyntheticActionDecisionRequest();
    const encoded = DecisionFeatureEncoder.encode(req);

    const alphaBuckets = StableIdentityEncoder.encodeActionIdentity("action.synthetic.alpha");
    const betaBuckets = StableIdentityEncoder.encodeActionIdentity("action.synthetic.beta");

    // alpha にあって beta にないバケット、beta にあって alpha にないバケットを探索
    let alphaOnlyBucket = -1;
    let betaOnlyBucket = -1;
    for (let b = 0; b < 16; b++) {
      if (alphaBuckets[b] === 1 && betaBuckets[b] === 0 && alphaOnlyBucket === -1) {
        alphaOnlyBucket = b;
      }
      if (betaBuckets[b] === 1 && alphaBuckets[b] === 0 && betaOnlyBucket === -1) {
        betaOnlyBucket = b;
      }
    }

    expect(alphaOnlyBucket).not.toBe(-1);
    expect(betaOnlyBucket).not.toBe(-1);

    const alphaPatternIdx = PATTERN_FEATURE_NAMES.indexOf(`candidate_action_bucket_${alphaOnlyBucket}` as any);
    const betaPatternIdx = PATTERN_FEATURE_NAMES.indexOf(`candidate_action_bucket_${betaOnlyBucket}` as any);
    const turnCountContextIdx = CONTEXT_FEATURE_NAMES.indexOf("turn_count"); // turn_count = 2

    // --- Case A: Genome A (alpha preference: turn_count x alpha_bucket = +5.0) ---
    const dnaAlpha = DecisionDNACodec.createZeroDecisionDNA({
      id: "proof-dna-alpha-preferred",
      name: "AlphaPreferredGenome",
    });
    const weightIdxAlpha = DecisionDNACodec.getContextPatternWeightIndex(turnCountContextIdx, alphaPatternIdx);
    (dnaAlpha.contextPatternWeights as number[])[weightIdxAlpha] = 5.0;
    DecisionDNACodec.validate(dnaAlpha);

    const scoresA = GenomeScorer.score(encoded, dnaAlpha);
    const scoreAlphaA = scoresA.find((s) => s.patternRef === 0)!.score;
    const scoreBetaA = scoresA.find((s) => s.patternRef === 1)!.score;

    expect(scoreAlphaA).toBeGreaterThan(scoreBetaA);
    // scoreAlphaA = 2 * 5.0 = 10, scoreBetaA = 0
    expect(scoreAlphaA).toBeCloseTo(10.0, 4);
    expect(scoreBetaA).toBeCloseTo(0.0, 4);

    // --- Case B: Genome B (beta preference: turn_count x beta_bucket = +5.0) ---
    const dnaBeta = DecisionDNACodec.createZeroDecisionDNA({
      id: "proof-dna-beta-preferred",
      name: "BetaPreferredGenome",
    });
    const weightIdxBeta = DecisionDNACodec.getContextPatternWeightIndex(turnCountContextIdx, betaPatternIdx);
    (dnaBeta.contextPatternWeights as number[])[weightIdxBeta] = 5.0;
    DecisionDNACodec.validate(dnaBeta);

    const scoresB = GenomeScorer.score(encoded, dnaBeta);
    const scoreAlphaB = scoresB.find((s) => s.patternRef === 0)!.score;
    const scoreBetaB = scoresB.find((s) => s.patternRef === 1)!.score;

    expect(scoreBetaB).toBeGreaterThan(scoreAlphaB);
    expect(scoreAlphaB).toBeCloseTo(0.0, 4);
    expect(scoreBetaB).toBeCloseTo(10.0, 4);

    // 【証明の完了】
    // 候補Action自体のメタデータ（speed, timing, cost, target等）が完全に同一であっても、
    // Candidate Action Stable Identity と盤面 Context の双線形相互作用により、
    // GenomeScorer レベルで alpha > beta および beta > alpha の双方が学習可能であることが直接証明された。
  });
});
