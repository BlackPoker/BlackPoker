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

describe("Down vs Up Request-Conditioned Selection Scorer Proof (Feature Schema v3)", () => {
  /**
   * 共通の盤面およびユニット候補を持つ DecisionRequest ファクトリ
   *
   * @param actionId "action.down" または "action.up"
   */
  const createDownOrUpDecisionRequest = (
    actionId: "action.down" | "action.up"
  ): DecisionRequest => {
    return {
      protocolVersion: "1.0.0",
      matchId: "match-down-up-test",
      decisionId: `dec-${actionId}-001`,
      stateVersion: 1,
      playerId: "p1",
      source: {
        type: "EFFECT_RESOLUTION",
        sourceRequestRef: `req-${actionId}`,
        effectStepId: "selectUnit",
        playerId: "p1",
      },
      observation: {
        viewerPlayerId: "p1",
        turnPlayerId: "p1",
        chancePlayerId: "p1",
        turnCount: 3,
        players: [
          {
            playerId: "p1",
            name: "Alice",
            isViewer: true,
            lifeCount: 12,
            lifeDisplay: "12",
            handCount: 4,
            handCards: [],
            field: [
              {
                unitId: "u-soldier-small",
                kind: "soldier",
                componentId: "character.soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 2,
              },
              {
                unitId: "u-soldier-large",
                kind: "soldier",
                componentId: "character.soldier",
                state: "charge",
                face: "up",
                cards: [],
                labels: [],
                currentSize: 8,
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
            handCount: 4,
            handCards: [],
            field: [],
            fog: [],
            trumps: [],
            graveCount: 0,
            grave: [],
            canViewFullGrave: false,
          },
        ],
        stageRequestRefs: [`req-${actionId}`],
        stageRequests: [
          {
            requestId: `req-${actionId}`,
            actionId: actionId,
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
        effectSelections: [
          {
            selectionType: "unit",
            selectedValues: ["u-soldier-small"], // 候補A: 小型兵士 (Size 2)
            summary: "小型兵士選択 (Size 2)",
          },
          {
            selectionType: "unit",
            selectedValues: ["u-soldier-large"], // 候補B: 大型兵士 (Size 8)
            summary: "大型兵士選択 (Size 8)",
          },
        ],
        orderSelections: [],
      },
      patterns: [
        {
          patternId: "pat-candidate-small",
          kind: "EFFECT_SELECTION",
          effectSelectionRef: 0,
        },
        {
          patternId: "pat-candidate-large",
          kind: "EFFECT_SELECTION",
          effectSelectionRef: 1,
        },
      ],
    };
  };

  it("1. encodes identical Pattern features for Candidate A and Candidate B regardless of Request action", () => {
    const downReq = createDownOrUpDecisionRequest("action.down");
    const upReq = createDownOrUpDecisionRequest("action.up");

    const downEncoded = DecisionFeatureEncoder.encode(downReq);
    const upEncoded = DecisionFeatureEncoder.encode(upReq);

    // Pattern 特徴量自体は、どちらの Request でも同一（候補A同士、候補B同士で完全一致）
    expect(downEncoded.patterns[0].values).toEqual(upEncoded.patterns[0].values);
    expect(downEncoded.patterns[1].values).toEqual(upEncoded.patterns[1].values);

    // 候補A (小型) と 候補B (大型) では、Unit Size 等の汎用 Pattern 特徴量が異なる
    const sizeMaxIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_unit_size_max");
    expect(downEncoded.patterns[0].values[sizeMaxIdx]).toBe(2);
    expect(downEncoded.patterns[1].values[sizeMaxIdx]).toBe(8);
  });

  it("2. encodes distinct Request Context features between Down and Up", () => {
    const downReq = createDownOrUpDecisionRequest("action.down");
    const upReq = createDownOrUpDecisionRequest("action.up");

    const downEncoded = DecisionFeatureEncoder.encode(downReq);
    const upEncoded = DecisionFeatureEncoder.encode(upReq);

    // 盤面特徴量は同一
    const turnCountIdx = CONTEXT_FEATURE_NAMES.indexOf("turn_count");
    expect(downEncoded.context.values[turnCountIdx]).toBe(upEncoded.context.values[turnCountIdx]);

    // Request Context の Action Identity Buckets が異なる
    const downBuckets = StableIdentityEncoder.encodeActionIdentity("action.down");
    const upBuckets = StableIdentityEncoder.encodeActionIdentity("action.up");
    expect(downBuckets).not.toEqual(upBuckets);

    for (let b = 0; b < 16; b++) {
      const bIdx = CONTEXT_FEATURE_NAMES.indexOf(`request_action_bucket_${b}` as any);
      expect(downEncoded.context.values[bIdx]).toBe(downBuckets[b]);
      expect(upEncoded.context.values[bIdx]).toBe(upBuckets[b]);
    }
  });

  it("3. Scorer-Level Proof: Genome learns different preferences (Down -> Small, Up -> Large) via Context x Pattern Interaction", () => {
    const downReq = createDownOrUpDecisionRequest("action.down");
    const upReq = createDownOrUpDecisionRequest("action.up");

    const downEncoded = DecisionFeatureEncoder.encode(downReq);
    const upEncoded = DecisionFeatureEncoder.encode(upReq);

    // 基準となる Zero DNA を作成
    const dna = DecisionDNACodec.createZeroDecisionDNA({
      id: "proof-down-up-dna",
      name: "DownUpProofGenome",
    });

    const sizeMaxPatternIdx = PATTERN_FEATURE_NAMES.indexOf("effect_selected_unit_size_max");
    expect(sizeMaxPatternIdx).not.toBe(-1);

    // Down のアクティブなハッシュバケットの1つを取得
    const downBuckets = StableIdentityEncoder.encodeActionIdentity("action.down");
    const downActiveBucket = downBuckets.indexOf(1);
    const downContextIdx = CONTEXT_FEATURE_NAMES.indexOf(`request_action_bucket_${downActiveBucket}` as any);

    // Up のアクティブなハッシュバケットの1つを取得 (Down で 0 のもの)
    const upBuckets = StableIdentityEncoder.encodeActionIdentity("action.up");
    let upActiveBucket = -1;
    for (let b = 0; b < 16; b++) {
      if (upBuckets[b] === 1 && downBuckets[b] === 0) {
        upActiveBucket = b;
        break;
      }
    }
    expect(upActiveBucket).not.toBe(-1);
    const upContextIdx = CONTEXT_FEATURE_NAMES.indexOf(`request_action_bucket_${upActiveBucket}` as any);

    // 【Interaction Weight の設定】
    // - Down × SizeMax に「負の重み (-2.0)」: Down の時はユニットサイズが小さい方を好む
    // - Up × SizeMax に「正の重み (+2.0)」: Up の時はユニットサイズが大きい方を好む
    const downWeightIdx = DecisionDNACodec.getContextPatternWeightIndex(downContextIdx, sizeMaxPatternIdx);
    const upWeightIdx = DecisionDNACodec.getContextPatternWeightIndex(upContextIdx, sizeMaxPatternIdx);

    (dna.contextPatternWeights as number[])[downWeightIdx] = -2.0;
    (dna.contextPatternWeights as number[])[upWeightIdx] = 2.0;

    DecisionDNACodec.validate(dna);

    // 1. Down リクエストのスコアリング
    const downScores = GenomeScorer.score(downEncoded, dna);
    const downSmallScore = downScores.find((s) => s.patternRef === 0)!.score; // Size 2
    const downLargeScore = downScores.find((s) => s.patternRef === 1)!.score; // Size 8

    // Down では小型兵士 (Size 2: score = -2 * 2 = -4) が 大型兵士 (Size 8: score = -2 * 8 = -16) より高スコア
    expect(downSmallScore).toBeGreaterThan(downLargeScore);

    // 2. Up リクエストのスコアリング
    const upScores = GenomeScorer.score(upEncoded, dna);
    const upSmallScore = upScores.find((s) => s.patternRef === 0)!.score; // Size 2
    const upLargeScore = upScores.find((s) => s.patternRef === 1)!.score; // Size 8

    // Up では大型兵士 (Size 8: score = 2 * 8 = 16) が 小型兵士 (Size 2: score = 2 * 2 = 4) より高スコア
    expect(upLargeScore).toBeGreaterThan(upSmallScore);

    // 【証明の完了】
    // 同一盤面・同一候補選択肢であっても、Request Context (Action Identity) と Pattern の
    // 双線形相互作用 (Context x Pattern Interaction) により、
    // Down では候補A (Small)、Up では候補B (Large) を決定論的に選択可能であることが直接証明された。
  });
});
