/**
 * gen9LearnableTactical.test.ts
 *
 * BlackPoker Simulator - Work 5-2 検証テスト
 * 1. Work 5-1 R1 コピー実装 (Gen9TacticalPrototypePolicyR1) と元コミット (fa21b51f677d4f5adf5ce5c2bce42d995d43fa60) の
 *    代表局面における判断・スコア一致検証、および R4 との意思決定比較の正確性検証
 * 2. Gen 9 学習可能戦術 Policy (Gen9LearnableTacticalPolicy) と Schema v6 / R4 の完全互換性・双方向変換検証
 * 3. 6つの戦術特徴量カテゴリの独立評価検証
 */

import { describe, it, expect, beforeAll } from "vitest";
import { DecisionRequest } from "../../domain/decision/DecisionRequest.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import { GenomePolicy } from "../../engine/ai/GenomePolicy.js";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy.js";
import {
  Gen9LearnableTacticalPolicy,
  TACTICAL_FEATURE_DIMENSION,
  TACTICAL_FEATURE_NAMES,
  TACTICAL_FEATURE_CATEGORY_MAP,
  ZERO_TACTICAL_WEIGHTS,
  R4_PRESET_TACTICAL_WEIGHTS,
  fromV6DNA,
  toV6CompatibleDNA,
  fromV6CompatibleDNA,
} from "../../engine/ai/Gen9LearnableTacticalPolicy.js";
import { GenericTacticalEvaluator } from "../../engine/rules/GenericTacticalEvaluator.js";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader.js";
import { createGen8ChampionCandidatePolicy } from "../../engine/ai/Gen8DNALoader.js";
import { Gen9TacticalPrototypePolicyR1 } from "../../../scripts/run_gen9_tactical_benchmark.js";

describe("Work 5-2: R1/R4意思決定比較検証 & Gen9LearnableTacticalPolicy 独立評価・互換性テスト", () => {
  let evaluator: GenericTacticalEvaluator;
  const gen8 = createGen8ChampionCandidatePolicy();
  const gen8DNA = DecisionDNACodec.clone((gen8 as any).dna);

  beforeAll(() => {
    const fullPkg = loadRulePackageForBrowser();
    evaluator = new GenericTacticalEvaluator(fullPkg);
    Gen9TacticalPrototypePolicy.setDefaultEvaluator(evaluator);
  });

  const createBaseRequest = (overrides?: Partial<DecisionRequest>): DecisionRequest => ({
    protocolVersion: "1.0.0",
    matchId: "match-test-work5-2",
    decisionId: "dec-work5-2-001",
    stateVersion: 1,
    playerId: "p2",
    source: {
      type: "ACTION_REQUEST",
      playerId: "p2",
    },
    observation: {
      viewerPlayerId: "p2",
      turnPlayerId: "p1",
      chancePlayerId: "p2",
      players: [
        {
          playerId: "p1",
          name: "Alice",
          isViewer: false,
          lifeCount: 15,
          lifeDisplay: "15",
          handCount: 4,
          handCards: [],
          field: [],
          fog: [],
          trumps: [],
          graveCount: 0,
          grave: [],
          canViewFullGrave: false,
        },
        {
          playerId: "p2",
          name: "Bob",
          isViewer: true,
          lifeCount: 10,
          lifeDisplay: "10",
          handCount: 5,
          handCards: [],
          field: [],
          fog: [],
          trumps: [],
          graveCount: 0,
          grave: [],
          canViewFullGrave: true,
        },
      ],
      stageRequestRefs: [],
      stageRequests: [],
      recentEvents: [],
    },
    catalog: {
      actions: [
        { actionId: "action.counter", actionName: "Counter", speed: "quick", timing: "quick" } as any,
        { actionId: "action.attack", actionName: "Attack", speed: "normal", timing: "normal" } as any,
        { actionId: "action.summonSoldier", actionName: "Summon", speed: "normal", timing: "normal" } as any,
      ],
      cardSelections: [],
      unitSelections: [],
      costPayments: [],
      targetSelections: [
        { targetType: "request", targetRequestId: "req-opp-1" } as any,
      ],
      effectSelections: [],
      orderSelections: [],
    },
    patterns: [
      {
        patternId: "pat-pass",
        kind: "PASS",
      },
      {
        patternId: "pat-counter",
        kind: "ACTION",
        actionSelectionRef: 0,
        targetSelectionRef: 0,
      },
    ],
    ...overrides,
  });

  // ===========================================================================
  // 1. Work 5-1 R1 コピー実装の代表局面一致検証および R4 との意思決定比較検証
  // ===========================================================================
  describe("1. Work 5-1 R1 コピー実装の元コミット一致検証と R4 との意思決定比較", () => {
    it("代表局面A (Turn 2 死の槍 成立): R1はキーカード単純合算(14>=10)でPASS=-3.0/Counter=+2.5を返し、R4はDSL確定損害(12>=10)でPASS=-2.5/Counter=+2.2を返す", () => {
      // 死の槍: ♢A(value=1) + ♠K(value=13), 対象: p2のサイズ2兵士(stackCount=2 -> damage = 13-(2-1)=12 >= life 10)
      const req = createBaseRequest({
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p1",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              name: "Alice",
              isViewer: false,
              lifeCount: 15,
              lifeDisplay: "15",
              handCount: 4,
              handCards: [],
              field: [],
              fog: [],
              trumps: [],
              graveCount: 0,
              grave: [],
              canViewFullGrave: false,
            },
            {
              playerId: "p2",
              name: "Bob",
              isViewer: true,
              lifeCount: 10,
              lifeDisplay: "10",
              handCount: 5,
              handCards: [],
              field: [
                {
                  unitId: "u-p2-soldier",
                  kind: "soldier",
                  state: "charge",
                  currentSize: 2,
                  stackCount: 2,
                  cards: [
                    { visibility: "KNOWN", suit: "spade", value: 2 },
                    { visibility: "UNKNOWN" },
                  ],
                } as any,
              ],
              fog: [],
              trumps: [],
              graveCount: 0,
              grave: [],
              canViewFullGrave: true,
            },
          ],
          stageRequestRefs: ["req-opp-1"],
          stageRequests: [
            {
              requestId: "req-opp-1",
              actionId: "action.deathLance",
              actionName: "死の槍",
              controller: "p1",
              keyCards: [
                { visibility: "KNOWN", suit: "diamond", value: 1 },
                { visibility: "KNOWN", suit: "spade", value: 13 },
              ],
              target: {
                targetType: "unit",
                targetUnitId: "u-p2-soldier",
              },
            } as any,
          ],
          recentEvents: [],
        },
      });

      const r1Policy = new Gen9TacticalPrototypePolicyR1(gen8DNA);
      const r4Policy = new Gen9TacticalPrototypePolicy(gen8DNA, "R4", evaluator);

      const r1Eval = r1Policy.evaluatePatterns(req);
      const r4Eval = r4Policy.evaluatePatterns(req);

      // R1 (fa21b51f677d4f5adf5ce5c2bce42d995d43fa60): estDamage = 1 + 13 = 14 >= life 10
      expect(r1Eval.scoredPatterns[0].tacticalAdjustment).toBeCloseTo(-3.0, 10);
      expect(r1Eval.scoredPatterns[1].tacticalAdjustment).toBeCloseTo(+2.5, 10);
      expect(r1Policy.choose(req).selectedPatternRef).toBe(1); // Counter

      // R4: DSL CERTAIN damage = 13 - (2 - 1) = 12 >= life 10
      expect(r4Eval.scoredPatterns[0].tacticalAdjustment).toBeCloseTo(-2.5, 10);
      expect(r4Eval.scoredPatterns[1].tacticalAdjustment).toBeCloseTo(+2.2, 10);
      expect(r4Policy.choose(req).selectedPatternRef).toBe(1); // Counter
    });

    it("代表局面B (死の槍 ガード不成立): R1はガード不成立を見落とす(PASS=-3.0/Counter=+2.5)が、R4はisGuardedOut=trueにより補正0でCounter無駄撃ちを防ぐ", () => {
      // 死の槍: ♢3(value=3) + ♠K(value=13) -> total=16 (ガード条件 [9,10,11,12,13,14] 外で不発)
      const req = createBaseRequest({
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p1",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              name: "Alice",
              isViewer: false,
              lifeCount: 15,
              lifeDisplay: "15",
              handCount: 4,
              handCards: [],
              field: [],
              fog: [],
              trumps: [],
              graveCount: 0,
              grave: [],
              canViewFullGrave: false,
            },
            {
              playerId: "p2",
              name: "Bob",
              isViewer: true,
              lifeCount: 10,
              lifeDisplay: "10",
              handCount: 5,
              handCards: [],
              field: [
                {
                  unitId: "u-p2-soldier",
                  kind: "soldier",
                  state: "charge",
                  currentSize: 7,
                  stackCount: 2,
                  cards: [{ visibility: "KNOWN", suit: "spade", value: 7 }],
                } as any,
              ],
              fog: [],
              trumps: [],
              graveCount: 0,
              grave: [],
              canViewFullGrave: true,
            },
          ],
          stageRequestRefs: ["req-opp-1"],
          stageRequests: [
            {
              requestId: "req-opp-1",
              actionId: "action.deathLance",
              actionName: "死の槍",
              controller: "p1",
              keyCards: [
                { visibility: "KNOWN", suit: "diamond", value: 3 },
                { visibility: "KNOWN", suit: "spade", value: 13 },
              ],
              target: {
                targetType: "unit",
                targetUnitId: "u-p2-soldier",
              },
            } as any,
          ],
          recentEvents: [],
        },
      });

      const r1Policy = new Gen9TacticalPrototypePolicyR1(gen8DNA);
      const r4Policy = new Gen9TacticalPrototypePolicy(gen8DNA, "R4", evaluator);

      const r1Eval = r1Policy.evaluatePatterns(req);
      const r4Eval = r4Policy.evaluatePatterns(req);

      // R1 はガード条件を判定せず 3+13=16 >= 10 として -3.0 / +2.5 を付与
      expect(r1Eval.scoredPatterns[0].tacticalAdjustment).toBeCloseTo(-3.0, 10);
      expect(r1Eval.scoredPatterns[1].tacticalAdjustment).toBeCloseTo(+2.5, 10);

      // R4 はガード不成立を正確に検知し、戦術補正 0.0
      expect(r4Eval.scoredPatterns[0].tacticalAdjustment).toBeCloseTo(0.0, 10);
      expect(r4Eval.scoredPatterns[1].tacticalAdjustment).toBeCloseTo(0.0, 10);
    });

    it("代表局面C (Turn 3 数的優位攻撃): R1は最大サイズ単純比較(13>8)で-0.60ペナルティを課すが、R4は数的優位(2体>1体)で+0.25ボーナスを付与する", () => {
      const req = createBaseRequest({
        playerId: "p2",
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              name: "Alice",
              isViewer: false,
              lifeCount: 12,
              lifeDisplay: "12",
              handCount: 4,
              handCards: [],
              field: [
                {
                  unitId: "u-p1-hero",
                  kind: "hero",
                  state: "charge",
                  currentSize: 13,
                  stackCount: 2,
                } as any,
              ],
              fog: [],
              trumps: [],
              graveCount: 0,
              grave: [],
              canViewFullGrave: false,
            },
            {
              playerId: "p2",
              name: "Bob",
              isViewer: true,
              lifeCount: 10,
              lifeDisplay: "10",
              handCount: 4,
              handCards: [],
              field: [
                {
                  unitId: "u-p2-s1",
                  kind: "soldier",
                  state: "charge",
                  currentSize: 3,
                  stackCount: 2,
                } as any,
                {
                  unitId: "u-p2-s2",
                  kind: "soldier",
                  state: "charge",
                  currentSize: 8,
                  stackCount: 2,
                } as any,
              ],
              fog: [],
              trumps: [],
              graveCount: 0,
              grave: [],
              canViewFullGrave: true,
            },
          ],
          stageRequestRefs: [],
          stageRequests: [],
          recentEvents: [],
        },
        patterns: [
          {
            patternId: "pat-pass",
            kind: "PASS",
          },
          {
            patternId: "pat-attack",
            kind: "ACTION",
            actionSelectionRef: 1, // action.attack
          },
        ],
      });

      const r1Policy = new Gen9TacticalPrototypePolicyR1(gen8DNA);
      const r4Policy = new Gen9TacticalPrototypePolicy(gen8DNA, "R4", evaluator);

      const r1Eval = r1Policy.evaluatePatterns(req);
      const r4Eval = r4Policy.evaluatePatterns(req);

      // R1: maxBlockerSize=13, myMaxAttackerSize=8 -> sizeDiff=5 -> -(0.2 + 0.08*5) = -0.60
      expect(r1Eval.scoredPatterns[1].tacticalAdjustment).toBeCloseTo(-0.6, 10);

      // R4: myAttackers.length (2) > activeBlockers.length (1) -> +0.25
      expect(r4Eval.scoredPatterns[1].tacticalAdjustment).toBeCloseTo(+0.25, 10);
    });
  });

  // ===========================================================================
  // 2. Schema v6 / R4 との完全互換性・双方向変換検証
  // ===========================================================================
  describe("2. Gen9LearnableTacticalPolicy と Schema v6 / R4 の完全互換性・双方向変換", () => {
    it("ZERO_TACTICAL_WEIGHTS 設定時、GenomePolicy (Schema v6) と全パターンスコア・選択手が完全一致する", () => {
      const req = createBaseRequest({
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p1",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              name: "Alice",
              isViewer: false,
              lifeCount: 15,
              lifeDisplay: "15",
              handCount: 4,
              handCards: [],
              field: [],
              fog: [],
              trumps: [],
              graveCount: 0,
              grave: [],
              canViewFullGrave: false,
            },
            {
              playerId: "p2",
              name: "Bob",
              isViewer: true,
              lifeCount: 10,
              lifeDisplay: "10",
              handCount: 5,
              handCards: [],
              field: [
                {
                  unitId: "u-p2-soldier",
                  kind: "soldier",
                  state: "charge",
                  currentSize: 2,
                  stackCount: 2,
                } as any,
              ],
              fog: [],
              trumps: [],
              graveCount: 0,
              grave: [],
              canViewFullGrave: true,
            },
          ],
          stageRequestRefs: ["req-opp-1"],
          stageRequests: [
            {
              requestId: "req-opp-1",
              actionId: "action.deathLance",
              actionName: "死の槍",
              controller: "p1",
              keyCards: [
                { visibility: "KNOWN", suit: "diamond", value: 1 },
                { visibility: "KNOWN", suit: "spade", value: 13 },
              ],
              target: {
                targetType: "unit",
                targetUnitId: "u-p2-soldier",
              },
            } as any,
          ],
          recentEvents: [],
        },
      });

      const v6Policy = new GenomePolicy(gen8DNA);
      const zeroGenome = fromV6DNA(gen8DNA, "zero");
      const learnableZeroPolicy = new Gen9LearnableTacticalPolicy(zeroGenome, "Zero", evaluator);

      const evalRes = learnableZeroPolicy.evaluatePatterns(req);
      for (const sp of evalRes.scoredPatterns) {
        expect(sp.tacticalAdjustment).toBe(0);
        expect(sp.finalScore).toBe(sp.baseScore);
      }
      expect(learnableZeroPolicy.choose(req)).toEqual(v6Policy.choose(req));
    });

    it("R4_PRESET_TACTICAL_WEIGHTS 設定時、Gen9TacticalPrototypePolicy (Work 5-1 R4) と全パターンスコア・調整値・選択手が完全一致する", () => {
      const scenarios: DecisionRequest[] = [
        // 1. 確定致死死の槍 vs Counter
        createBaseRequest({
          observation: {
            viewerPlayerId: "p2",
            turnPlayerId: "p1",
            chancePlayerId: "p2",
            players: [
              {
                playerId: "p1",
                name: "Alice",
                isViewer: false,
                lifeCount: 15,
                lifeDisplay: "15",
                handCount: 4,
                handCards: [],
                field: [],
                fog: [],
                trumps: [],
                graveCount: 0,
                grave: [],
                canViewFullGrave: false,
              },
              {
                playerId: "p2",
                name: "Bob",
                isViewer: true,
                lifeCount: 10,
                lifeDisplay: "10",
                handCount: 5,
                handCards: [],
                field: [{ unitId: "u-p2-s", kind: "soldier", state: "charge", currentSize: 2, stackCount: 2 } as any],
                fog: [],
                trumps: [],
                graveCount: 0,
                grave: [],
                canViewFullGrave: true,
              },
            ],
            stageRequestRefs: ["req-opp-1"],
            stageRequests: [
              {
                requestId: "req-opp-1",
                actionId: "action.deathLance",
                actionName: "死の槍",
                controller: "p1",
                keyCards: [
                  { visibility: "KNOWN", suit: "diamond", value: 1 },
                  { visibility: "KNOWN", suit: "spade", value: 13 },
                ],
                target: {
                targetType: "unit",
                targetUnitId: "u-p2-s",
              },
              } as any,
            ],
            recentEvents: [],
          },
        }),
        // 2. 非公開情報を含む推定致死リスク死の槍
        createBaseRequest({
          observation: {
            viewerPlayerId: "p2",
            turnPlayerId: "p1",
            chancePlayerId: "p2",
            players: [
              {
                playerId: "p1",
                name: "Alice",
                isViewer: false,
                lifeCount: 15,
                lifeDisplay: "15",
                handCount: 4,
                handCards: [],
                field: [],
                fog: [],
                trumps: [],
                graveCount: 0,
                grave: [],
                canViewFullGrave: false,
              },
              {
                playerId: "p2",
                name: "Bob",
                isViewer: true,
                lifeCount: 8,
                lifeDisplay: "8",
                handCount: 5,
                handCards: [],
                field: [{ unitId: "u-p2-s", kind: "soldier", state: "charge", currentSize: 3, stackCount: 2 } as any],
                fog: [],
                trumps: [],
                graveCount: 0,
                grave: [],
                canViewFullGrave: true,
              },
            ],
            stageRequestRefs: ["req-opp-1"],
            stageRequests: [
              {
                requestId: "req-opp-1",
                actionId: "action.deathLance",
                actionName: "死の槍",
                controller: "p1",
                keyCards: [
                  { visibility: "UNKNOWN" },
                  { visibility: "KNOWN", suit: "spade", value: 12 },
                ],
                target: {
                targetType: "unit",
                targetUnitId: "u-p2-s",
              },
              } as any,
            ],
            recentEvents: [],
          },
        }),
        // 3. 犬死攻撃抑制と瀕死時兵士召喚ボーナス
        createBaseRequest({
          observation: {
            viewerPlayerId: "p2",
            turnPlayerId: "p2",
            chancePlayerId: "p2",
            players: [
              {
                playerId: "p1",
                name: "Alice",
                isViewer: false,
                lifeCount: 12,
                lifeDisplay: "12",
                handCount: 4,
                handCards: [],
                field: [{ unitId: "u-p1-h", kind: "hero", state: "charge", currentSize: 13, stackCount: 2 } as any],
                fog: [],
                trumps: [],
                graveCount: 0,
                grave: [],
                canViewFullGrave: false,
              },
              {
                playerId: "p2",
                name: "Bob",
                isViewer: true,
                lifeCount: 5,
                lifeDisplay: "5",
                handCount: 4,
                handCards: [],
                field: [{ unitId: "u-p2-s", kind: "soldier", state: "charge", currentSize: 3, stackCount: 2 } as any],
                fog: [],
                trumps: [],
                graveCount: 0,
                grave: [],
                canViewFullGrave: true,
              },
            ],
            stageRequestRefs: [],
            stageRequests: [],
            recentEvents: [],
          },
          patterns: [
            { patternId: "pat-pass", kind: "PASS" },
            { patternId: "pat-attack", kind: "ACTION", actionSelectionRef: 1 },
            { patternId: "pat-summon", kind: "ACTION", actionSelectionRef: 2 },
          ],
        }),
      ];

      const r4Policy = new Gen9TacticalPrototypePolicy(gen8DNA, "R4", evaluator);
      const r4Genome = fromV6DNA(gen8DNA, "r4");
      const learnableR4Policy = new Gen9LearnableTacticalPolicy(r4Genome, "LearnableR4", evaluator);

      for (const req of scenarios) {
        const expected = r4Policy.evaluatePatterns(req);
        const actual = learnableR4Policy.evaluatePatterns(req);

        expect(actual.bestPatternRef).toBe(expected.bestPatternRef);
        expect(actual.scoredPatterns.length).toBe(expected.scoredPatterns.length);

        for (let i = 0; i < expected.scoredPatterns.length; i++) {
          expect(actual.scoredPatterns[i].baseScore).toBeCloseTo(expected.scoredPatterns[i].baseScore, 12);
          expect(actual.scoredPatterns[i].tacticalAdjustment).toBeCloseTo(
            expected.scoredPatterns[i].tacticalAdjustment,
            12
          );
          expect(actual.scoredPatterns[i].finalScore).toBeCloseTo(expected.scoredPatterns[i].finalScore, 12);
        }
      }
    });

    it("toV6CompatibleDNA と fromV6CompatibleDNA により、任意の学習済み20次元戦術重みが Schema v6 検証を通過しつつ無損失で往復変換できる", () => {
      const customWeights = R4_PRESET_TACTICAL_WEIGHTS.map((w, idx) => w * (1 + (idx - 10) * 0.03));
      const genome = fromV6DNA(gen8DNA, customWeights, {
        id: "gen9-pilot-test-ind1",
        name: "Gen9 Pilot Test Individual 1",
        generation: 9,
        notes: "unit-test-roundtrip",
      });

      const v6Compat = toV6CompatibleDNA(genome);
      // 既存 DecisionDNACodec.validate (Schema v6) をエラーなく通過すること
      expect(() => DecisionDNACodec.validate(v6Compat)).not.toThrow();

      // JSON シリアライズ・デシリアライズを経ても完全復元できること
      const serialized = DecisionDNACodec.serialize(v6Compat);
      const parsedDNA = DecisionDNACodec.deserialize(serialized);
      const restored = fromV6CompatibleDNA(parsedDNA);

      expect(restored.tacticalSchemaVersion).toBe(7);
      expect(restored.tacticalWeights.length).toBe(TACTICAL_FEATURE_DIMENSION);
      for (let k = 0; k < TACTICAL_FEATURE_DIMENSION; k++) {
        expect(restored.tacticalWeights[k]).toBeCloseTo(customWeights[k], 12);
      }
      expect(restored.metadata?.id).toBe("gen9-pilot-test-ind1");
      expect(restored.metadata?.notes).toBe("unit-test-roundtrip");
    });
  });

  // ===========================================================================
  // 3. 6つの戦術特徴量カテゴリの独立評価検証
  // ===========================================================================
  describe("3. 6つの戦術特徴量カテゴリの独立評価検証", () => {
    it("全20次元の戦術特徴量が6カテゴリすべてに漏れなくマッピングされ、カテゴリ単位で独立して寄与度を分離評価できる", () => {
      expect(TACTICAL_FEATURE_DIMENSION).toBe(20);
      const seenCategories = new Set<string>();
      for (const name of TACTICAL_FEATURE_NAMES) {
        const cat = TACTICAL_FEATURE_CATEGORY_MAP[name];
        expect(cat).toBeDefined();
        seenCategories.add(cat);
      }
      expect(Array.from(seenCategories).sort()).toEqual(
        [
          "CERTAIN_DAMAGE",
          "COMBAT_OUTCOME",
          "COUNTER_PREVENTION",
          "ESTIMATED_DAMAGE",
          "LETHAL_OPPORTUNITY",
          "SURVIVAL",
        ].sort()
      );

      // 確定致死リクエスト + Counter + リーサル未ブロック攻撃 + 瀕死時兵士召喚を同時に含む複合局面で独立分離を確認
      const compositeReq = createBaseRequest({
        observation: {
          viewerPlayerId: "p2",
          turnPlayerId: "p2",
          chancePlayerId: "p2",
          players: [
            {
              playerId: "p1",
              name: "Alice",
              isViewer: false,
              lifeCount: 5,
              lifeDisplay: "5",
              handCount: 4,
              handCards: [],
              field: [],
              fog: [],
              trumps: [],
              graveCount: 0,
              grave: [],
              canViewFullGrave: false,
            },
            {
              playerId: "p2",
              name: "Bob",
              isViewer: true,
              lifeCount: 5,
              lifeDisplay: "5",
              handCount: 4,
              handCards: [],
              field: [
                {
                  unitId: "u-p2-s",
                  kind: "soldier",
                  state: "charge",
                  currentSize: 6,
                  stackCount: 2,
                } as any,
              ],
              fog: [],
              trumps: [],
              graveCount: 0,
              grave: [],
              canViewFullGrave: true,
            },
          ],
          stageRequestRefs: ["req-opp-1"],
          stageRequests: [
            {
              requestId: "req-opp-1",
              actionId: "action.deathLance",
              actionName: "死の槍",
              controller: "p1",
              keyCards: [
                { visibility: "KNOWN", suit: "diamond", value: 1 },
                { visibility: "KNOWN", suit: "spade", value: 13 },
              ],
              target: {
                targetType: "unit",
                targetUnitId: "u-p2-s",
              },
            } as any,
          ],
          recentEvents: [],
        },
        patterns: [
          { patternId: "pat-pass", kind: "PASS" },
          {
            patternId: "pat-counter",
            kind: "ACTION",
            actionSelectionRef: 0,
            targetSelectionRef: 0,
          },
          { patternId: "pat-attack", kind: "ACTION", actionSelectionRef: 1 },
          { patternId: "pat-summon", kind: "ACTION", actionSelectionRef: 2 },
        ],
      });

      const policy = new Gen9LearnableTacticalPolicy(fromV6DNA(gen8DNA, "r4"), "Composite", evaluator);
      const res = policy.evaluatePatterns(compositeReq);

      const passDetail = res.scoredPatterns.find((p) => p.patternRef === 0)!;
      const counterDetail = res.scoredPatterns.find((p) => p.patternRef === 1)!;
      const attackDetail = res.scoredPatterns.find((p) => p.patternRef === 2)!;
      const summonDetail = res.scoredPatterns.find((p) => p.patternRef === 3)!;

      // PASS: CERTAIN_DAMAGE のみ非ゼロ (-2.5)
      expect(passDetail.categoryBreakdown.CERTAIN_DAMAGE).toBeCloseTo(-2.5, 10);
      expect(passDetail.categoryBreakdown.COUNTER_PREVENTION).toBe(0);

      // Counter: COUNTER_PREVENTION のみ非ゼロ (+2.2)
      expect(counterDetail.categoryBreakdown.COUNTER_PREVENTION).toBeCloseTo(+2.2, 10);
      expect(counterDetail.categoryBreakdown.CERTAIN_DAMAGE).toBe(0);

      // Attack (totalAtk=6 >= oppLife=5, unblocked): LETHAL_OPPORTUNITY のみ非ゼロ (+2.0)
      expect(attackDetail.categoryBreakdown.LETHAL_OPPORTUNITY).toBeCloseTo(+2.0, 10);
      expect(attackDetail.categoryBreakdown.SURVIVAL).toBe(0);

      // Summon (selfLife=5 <= 6): SURVIVAL のみ非ゼロ (+0.1)
      expect(summonDetail.categoryBreakdown.SURVIVAL).toBeCloseTo(+0.1, 10);
      expect(summonDetail.categoryBreakdown.LETHAL_OPPORTUNITY).toBe(0);
    });
  });
});
