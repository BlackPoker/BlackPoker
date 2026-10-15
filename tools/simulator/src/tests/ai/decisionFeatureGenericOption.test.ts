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

describe("Generic Option Stable Identity & Scorer Proof (Feature Schema v4)", () => {
  /**
   * 任意の option values を持つ EFFECT_SELECTION DecisionRequest ファクトリ
   */
  const createOptionDecisionRequest = (
    options: string[],
    sourceActionId: string = "action.reset"
  ): DecisionRequest => {
    return {
      protocolVersion: "1.0.0",
      matchId: "match-generic-option-test",
      decisionId: "dec-generic-option-001",
      stateVersion: 1,
      playerId: "p1",
      source: {
        type: "EFFECT_RESOLUTION",
        sourceRequestRef: "req-source-1",
        sourceActionId,
        effectStepId: "selectMode",
        playerId: "p1",
      },
      observation: {
        viewerPlayerId: "p1",
        turnPlayerId: "p1",
        chancePlayerId: "p1",
        turnCount: 4,
        players: [
          {
            playerId: "p1",
            name: "Alice",
            isViewer: true,
            lifeCount: 8,
            lifeDisplay: "8",
            handCount: 2,
            handCards: [],
            field: [],
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
            lifeCount: 8,
            lifeDisplay: "8",
            handCount: 2,
            handCards: [],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: false,
          },
        ],
        stageRequestRefs: ["req-source-1"],
        stageRequests: [
          {
            requestId: "req-source-1",
            actionId: sourceActionId,
            controller: "p1",
            status: "resolving",
            sequence: 1,
          },
        ],
        recentEvents: [],
      },
      catalog: {
        actions: [],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: options.map((optVal, idx) => ({
          selectionType: "option",
          selectedValues: [optVal],
          summary: `選択: ${optVal}`,
          candidateCount: options.length,
        })),
        orderSelections: [],
      },
      patterns: options.map((optVal, idx) => ({
        patternId: `pat-option-${idx}-${optVal}`,
        kind: "EFFECT_SELECTION",
        effectSelectionRef: idx,
      })),
    };
  };

  it("1. distinguishes charge vs drive via effect_option_bucket_0..15 without relying on unit hack", () => {
    const req = createOptionDecisionRequest(["charge", "drive"]);
    const encoded = DecisionFeatureEncoder.encode(req);

    expect(encoded.patterns.length).toBe(2);

    const chargeBuckets = StableIdentityEncoder.encodeOptionIdentity("charge");
    const driveBuckets = StableIdentityEncoder.encodeOptionIdentity("drive");

    expect(chargeBuckets).not.toEqual(driveBuckets);

    const chargePatValues = encoded.patterns[0].values;
    const drivePatValues = encoded.patterns[1].values;

    for (let b = 0; b < 16; b++) {
      const idx = PATTERN_FEATURE_NAMES.indexOf(`effect_option_bucket_${b}` as any);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(chargePatValues[idx]).toBe(chargeBuckets[b]);
      expect(drivePatValues[idx]).toBe(driveBuckets[b]);
    }

    // unit由来の charge/drive カウントは 0 であること（盤面に unit が存在しないため hack が発火していないことの確認）
    const unitChargeIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_unit_charge_count");
    const unitDriveIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_unit_drive_count");
    expect(chargePatValues[unitChargeIdx]).toBe(0);
    expect(chargePatValues[unitDriveIdx]).toBe(0);
    expect(drivePatValues[unitChargeIdx]).toBe(0);
    expect(drivePatValues[unitDriveIdx]).toBe(0);
  });

  it("2. cleanly distinguishes arbitrary and future option values (send_to_grave vs keep_in_play, mode_alpha vs mode_beta)", () => {
    const reqFuture = createOptionDecisionRequest(["send_to_grave", "keep_in_play", "future_trump_mode_x"]);
    const encoded = DecisionFeatureEncoder.encode(reqFuture);

    expect(encoded.patterns.length).toBe(3);

    const graveBuckets = StableIdentityEncoder.encodeOptionIdentity("send_to_grave");
    const keepBuckets = StableIdentityEncoder.encodeOptionIdentity("keep_in_play");
    const trumpBuckets = StableIdentityEncoder.encodeOptionIdentity("future_trump_mode_x");

    // 全て互いに異なるバケット分布を持つこと
    expect(graveBuckets).not.toEqual(keepBuckets);
    expect(graveBuckets).not.toEqual(trumpBuckets);
    expect(keepBuckets).not.toEqual(trumpBuckets);

    for (let b = 0; b < 16; b++) {
      const idx = PATTERN_FEATURE_NAMES.indexOf(`effect_option_bucket_${b}` as any);
      expect(encoded.patterns[0].values[idx]).toBe(graveBuckets[b]);
      expect(encoded.patterns[1].values[idx]).toBe(keepBuckets[b]);
      expect(encoded.patterns[2].values[idx]).toBe(trumpBuckets[b]);
    }
  });

  it("3. aggregates multiple selected options via bucket-wise OR", () => {
    const multiOptReq: DecisionRequest = {
      ...createOptionDecisionRequest(["single_opt"]),
      catalog: {
        actions: [],
        cardSelections: [],
        unitSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [
          {
            selectionType: "option",
            selectedValues: ["mode_a", "mode_b"],
            summary: "複数選択: mode_a, mode_b",
            candidateCount: 2,
          },
        ],
        orderSelections: [],
      },
      patterns: [
        {
          patternId: "pat-multi",
          kind: "EFFECT_SELECTION",
          effectSelectionRef: 0,
        },
      ],
    };

    const encoded = DecisionFeatureEncoder.encode(multiOptReq);
    const multiBuckets = StableIdentityEncoder.encodeOptionIdentities(["mode_a", "mode_b"]);
    const bucketA = StableIdentityEncoder.encodeOptionIdentity("mode_a");
    const bucketB = StableIdentityEncoder.encodeOptionIdentity("mode_b");

    for (let b = 0; b < 16; b++) {
      const expected = bucketA[b] === 1 || bucketB[b] === 1 ? 1 : 0;
      expect(multiBuckets[b]).toBe(expected);

      const idx = PATTERN_FEATURE_NAMES.indexOf(`effect_option_bucket_${b}` as any);
      expect(encoded.patterns[0].values[idx]).toBe(expected);
    }
  });

  it("4. Scorer-Level Proof: Genome learns different option preferences (optA > optB and optB > optA) via Context x Option Interaction", () => {
    const req = createOptionDecisionRequest(["mode_alpha", "mode_beta"], "action.reset");
    const encoded = DecisionFeatureEncoder.encode(req);

    const alphaBuckets = StableIdentityEncoder.encodeOptionIdentity("mode_alpha");
    const betaBuckets = StableIdentityEncoder.encodeOptionIdentity("mode_beta");

    // mode_alpha にあって mode_beta にないバケット、mode_beta にあって mode_alpha にないバケットを探索
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

    const alphaOptionIdx = PATTERN_FEATURE_NAMES.indexOf(`effect_option_bucket_${alphaOnlyBucket}` as any);
    const betaOptionIdx = PATTERN_FEATURE_NAMES.indexOf(`effect_option_bucket_${betaOnlyBucket}` as any);
    const turnCountContextIdx = CONTEXT_FEATURE_NAMES.indexOf("turn_count"); // turn_count = 4

    // --- Case A: Genome Alpha (turn_count x alpha_option = +3.0) ---
    const dnaAlpha = DecisionDNACodec.createZeroDecisionDNA({
      id: "proof-dna-option-alpha",
      name: "OptionAlphaGenome",
    });
    const weightIdxAlpha = DecisionDNACodec.getContextPatternWeightIndex(turnCountContextIdx, alphaOptionIdx);
    (dnaAlpha.contextPatternWeights as number[])[weightIdxAlpha] = 3.0;
    DecisionDNACodec.validate(dnaAlpha);

    const scoresA = GenomeScorer.score(encoded, dnaAlpha);
    const scoreAlphaA = scoresA.find((s) => s.patternRef === 0)!.score;
    const scoreBetaA = scoresA.find((s) => s.patternRef === 1)!.score;

    expect(scoreAlphaA).toBeGreaterThan(scoreBetaA);
    // Schema v5: turn_count = 4 scaled to 4 / (4 + 10) = 2/7, so scoreAlphaA = (2/7) * 3.0 = 6/7
    expect(scoreAlphaA).toBeCloseTo(6 / 7, 4);
    expect(scoreBetaA).toBeCloseTo(0.0, 4);

    // --- Case B: Genome Beta (turn_count x beta_option = +3.0) ---
    const dnaBeta = DecisionDNACodec.createZeroDecisionDNA({
      id: "proof-dna-option-beta",
      name: "OptionBetaGenome",
    });
    const weightIdxBeta = DecisionDNACodec.getContextPatternWeightIndex(turnCountContextIdx, betaOptionIdx);
    (dnaBeta.contextPatternWeights as number[])[weightIdxBeta] = 3.0;
    DecisionDNACodec.validate(dnaBeta);

    const scoresB = GenomeScorer.score(encoded, dnaBeta);
    const scoreAlphaB = scoresB.find((s) => s.patternRef === 0)!.score;
    const scoreBetaB = scoresB.find((s) => s.patternRef === 1)!.score;

    expect(scoreBetaB).toBeGreaterThan(scoreAlphaB);
    expect(scoreAlphaB).toBeCloseTo(0.0, 4);
    // Schema v5: scoreBetaB = (2/7) * 3.0 = 6/7
    expect(scoreBetaB).toBeCloseTo(6 / 7, 4);

    // 【証明の完了】
    // 同一盤面における任意の Generic Option 選択肢であっても、
    // Generic Option Stable Identity (16 buckets) と盤面 Context の双線形相互作用により、
    // GenomeScorer レベルで任意の選択肢選好を学習可能であることが直接証明された。
  });
});
