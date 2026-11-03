import { describe, it, expect, beforeAll } from "vitest";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator.js";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry.js";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader.js";
import { RulePackage } from "../../domain/rules/RulePackage.js";
import { TurnManager } from "../../engine/rules/TurnManager.js";
import { isSoldierType } from "../../engine/rules/characterUtils.js";
import { LegalPattern } from "../../domain/decision/LegalPattern.js";
import { UnitAssignment, EffectSelection } from "../../domain/decision/DecisionCatalog.js";
import { DecisionRequest, BlockAssignmentStreamProvider } from "../../domain/decision/DecisionRequest.js";
import { GenomePolicy } from "../../engine/ai/GenomePolicy.js";
import { GenomeScorer } from "../../engine/ai/GenomeScorer.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import { DecisionFeatureEncoder } from "../../engine/ai/DecisionFeatureEncoder.js";
import { DecisionDNA, DecisionDNAExecutionError, DecisionDNAValidationError } from "../../domain/ai/DecisionDNATypes.js";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy.js";
import { GameSession } from "../../engine/session/GameSession.js";
import { GameSessionSnapshotCodec } from "../../engine/session/GameSessionSnapshotCodec.js";
import { StateHasher } from "../../engine/simulation/StateHasher.js";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner.js";
import * as path from "path";

describe("Block Assignment Optimization Benchmark & Integrity Verification (Work 3-5 R2)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  const components: any[] = [{ id: "comp-soldier", properties: { characterType: "soldier" } }];
  const mockRequest: any = { id: "req-block", actionId: "action.block" };
  const mockState: any = { stateVersion: 1, players: {} };

  const createSoldierUnit = (unitId: string) => ({
    unitId,
    kind: "soldier",
    componentId: "comp-soldier",
    properties: { characterType: "soldier" },
  });

  const getReq = (step: any): DecisionRequest => {
    if (!step || step.type !== "WAITING_FOR_DECISION" || !step.request) {
      throw new Error(`Expected WAITING_FOR_DECISION step with request, got: ${JSON.stringify(step)}`);
    }
    return step.request as DecisionRequest;
  };

  const createLargeBattleSession = () => {
    // p1: 3体のアタッカー (soldier-a0, soldier-a1, soldier-a2)
    // p2: 5体の一般兵ブロッカー (soldier-d0..d4)
    // パターン数: (3+1)^5 = 1024 件 (> 256)
    const attackers = [
      {
        unitId: "soldier-a0",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "ca0", suit: "S", rank: "8", value: 8 }],
        labels: ["攻撃", "防御"],
      },
      {
        unitId: "soldier-a1",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "ca1", suit: "H", rank: "6", value: 6 }],
        labels: ["攻撃", "防御"],
      },
      {
        unitId: "soldier-a2",
        kind: "一般兵",
        componentId: "character.soldier",
        state: "charge",
        cards: [{ id: "ca2", suit: "D", rank: "4", value: 4 }],
        labels: ["攻撃", "防御"],
      },
    ];

    const defenders = Array.from({ length: 5 }, (_, i) => ({
      unitId: `soldier-d${i}`,
      kind: "一般兵",
      componentId: "character.soldier",
      state: "charge",
      cards: [{ id: `cd${i}`, suit: "C", rank: "5", value: 5 }],
      labels: ["防御", "攻撃"],
    }));

    const state: any = {
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          name: "Player 1",
          life: [
            { id: "l1-1", suit: "S", rank: "A", value: 1 },
            { id: "l1-2", suit: "H", rank: "2", value: 2 },
          ],
          hand: [
            { id: "key-s8", suit: "S", rank: "8", value: 8 },
            { id: "cost-c2", suit: "C", rank: "2", value: 2 },
          ],
          field: attackers,
          graveyard: [],
        },
        p2: {
          name: "Player 2",
          life: [
            { id: "l2-1", suit: "D", rank: "K", value: 13 },
            { id: "l2-2", suit: "C", rank: "Q", value: 12 },
          ],
          hand: [],
          field: defenders,
          graveyard: [],
        },
      },
      stage: { requests: [], history: [] },
      requestBuffer: { requests: [], history: [] },
    };

    const session = new GameSession(state, rulePackage);

    // 1. p1 が attack を実行
    const step1 = session.advance();
    const req1 = getReq(step1);
    const atkRef = req1.patterns.findIndex((p: any) => {
      const act = req1.catalog.actions[p.actionSelectionRef!];
      return act?.actionId === "action.attack";
    });
    session.submitDecision({ decisionId: req1.decisionId, stateVersion: req1.stateVersion, selectedPatternRef: atkRef });

    // 2. p1 PASS
    const step2 = session.advance();
    const req2 = getReq(step2);
    session.submitDecision({
      decisionId: req2.decisionId,
      stateVersion: req2.stateVersion,
      selectedPatternRef: req2.patterns.findIndex((p: any) => p.kind === "PASS"),
    });

    // 3. p2 PASS -> attack 解決開始
    const step3 = session.advance();
    const req3 = getReq(step3);
    const step4 = session.submitDecision({
      decisionId: req3.decisionId,
      stateVersion: req3.stateVersion,
      selectedPatternRef: req3.patterns.findIndex((p: any) => p.kind === "PASS"),
    });

    // 3体全アタックを選択
    const req4 = getReq(step4);
    const multiAtkRef = req4.patterns.findIndex((p) => {
      const eff = req4.catalog.effectSelections[p.effectSelectionRef!];
      return eff.selectedValues?.length === 3;
    });
    session.submitDecision({
      decisionId: req4.decisionId,
      stateVersion: req4.stateVersion,
      selectedPatternRef: multiAtkRef,
    });

    // 4. 双方が PASS して stage の action.block 解決 (EFFECT_RESOLUTION) に進める
    let currentStep = session.advance();
    while (currentStep.type === "WAITING_FOR_DECISION" && (currentStep as any).request?.source.type === "ACTION_REQUEST") {
      const req = (currentStep as any).request;
      const passIdx = req.patterns.findIndex((p: any) => p.kind === "PASS");
      currentStep = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: passIdx !== -1 ? passIdx : 0,
      });
      if (currentStep.type !== "WAITING_FOR_DECISION") {
        currentStep = session.advance();
      }
    }

    return { session, blockStep: currentStep };
  };

  // ===========================================================================
  // A. 合法手の完全同等性 (Legacy vs Streaming)
  // ===========================================================================
  describe("A. 合法手の完全同等性 (Legacy vs Streaming)", () => {
    it("A=1, B=2 (兵士2体): 全4パターンが完全に同一の順序・同一の割り当てで生成されること", () => {
      const attackers = [createSoldierUnit("atk-0")];
      const blockers = [createSoldierUnit("blk-0"), createSoldierUnit("blk-1")];

      // 従来方式 (全展開)
      const legacyResult = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components,
        { maxFullPatternLimit: Infinity }
      );
      const legacyAssignments = legacyResult.request.catalog.effectSelections.map((es) => es.assignments);

      // 最適化方式 (遅延ストリーミング)
      const optimizedAssignments: UnitAssignment[][] = [];
      for (const a of LegalPatternGenerator.iterateBlockAssignments(attackers, blockers, components)) {
        optimizedAssignments.push(a);
      }

      expect(optimizedAssignments.length).toBe(legacyAssignments.length);
      expect(optimizedAssignments.length).toBe(4); // (1+1)^2 = 4

      for (let i = 0; i < legacyAssignments.length; i++) {
        expect(optimizedAssignments[i]).toEqual(legacyAssignments[i]);
      }
    });

    it("A=2, B=3 (兵士3体): 全27パターンが完全に同一の順序・同一の割り当てで生成されること", () => {
      const attackers = [createSoldierUnit("atk-0"), createSoldierUnit("atk-1")];
      const blockers = [
        createSoldierUnit("blk-0"),
        createSoldierUnit("blk-1"),
        createSoldierUnit("blk-2"),
      ];

      const legacyResult = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components,
        { maxFullPatternLimit: Infinity }
      );
      const legacyAssignments = legacyResult.request.catalog.effectSelections.map((es) => es.assignments);

      const optimizedAssignments: UnitAssignment[][] = [];
      for (const a of LegalPatternGenerator.iterateBlockAssignments(attackers, blockers, components)) {
        optimizedAssignments.push(a);
      }

      expect(optimizedAssignments.length).toBe(legacyAssignments.length);
      expect(optimizedAssignments.length).toBe(27); // (2+1)^3 = 27

      for (let i = 0; i < legacyAssignments.length; i++) {
        expect(optimizedAssignments[i]).toEqual(legacyAssignments[i]);
      }
    });

    it("複合ブロッカー (防壁1体 + 兵士2体): 単独ブロックのみの防壁と複数ブロック可能な兵士が正しく整合すること", () => {
      const attackers = [createSoldierUnit("atk-0")];
      const blockers = [
        { unitId: "bulwark-0", kind: "bulwark", properties: { characterType: "bulwark" } },
        createSoldierUnit("soldier-0"),
        createSoldierUnit("soldier-1"),
      ];
      const customComponents: any = [
        { id: "comp-bulwark", properties: { characterType: "bulwark" } },
        { id: "comp-soldier", properties: { characterType: "soldier" } },
      ];

      const legacyResult = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        customComponents,
        { maxFullPatternLimit: Infinity }
      );
      const legacyAssignments = legacyResult.request.catalog.effectSelections.map((es) => es.assignments);

      const optimizedAssignments: UnitAssignment[][] = [];
      for (const a of LegalPatternGenerator.iterateBlockAssignments(attackers, blockers, customComponents)) {
        optimizedAssignments.push(a);
      }

      expect(optimizedAssignments.length).toBe(legacyAssignments.length);
      expect(optimizedAssignments.length).toBe(5); // 0体(1) + 単体(3) + 複数兵士(1) = 5

      for (let i = 0; i < legacyAssignments.length; i++) {
        expect(optimizedAssignments[i]).toEqual(legacyAssignments[i]);
      }
    });
  });

  // ===========================================================================
  // B. GenomePolicy のスコア・選択同等性
  // ===========================================================================
  describe("B. GenomePolicy のスコア・選択同等性", () => {
    it("同一盤面・同一DNAにおいて、従来の一括評価とストリーミング評価が完全同一の手を選択すること", () => {
      const attackers = [createSoldierUnit("atk-0"), createSoldierUnit("atk-1")];
      const blockers = [createSoldierUnit("blk-0"), createSoldierUnit("blk-1"), createSoldierUnit("blk-2")];

      // 非ゼロ重みを持つテスト用 DNA
      const dna = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-test" });
      (dna.patternWeights as number[])[0] = 0.5;
      (dna.patternWeights as number[])[68] = 1.2; // effAssignSelectedCount 重み
      (dna.patternWeights as number[])[70] = -0.8; // effAssignSelectedSizeSum 重み

      const reqLegacy = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components,
        { maxFullPatternLimit: Infinity }
      ).request;

      const reqStream = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components,
        { maxFullPatternLimit: 0 } // 強制ストリーミングモード
      ).request;

      expect(reqLegacy.patterns.length).toBe(27);
      expect(reqStream.patterns.length).toBe(0);
      expect(reqStream.blockAssignmentStream).toBeDefined();

      const policy = new GenomePolicy(dna);
      const resLegacy = policy.choose(reqLegacy);
      const resStream = policy.choose(reqStream);

      expect(resStream.selectedPatternRef).toBe(resLegacy.selectedPatternRef);
      const stream = reqStream.blockAssignmentStream!;
      const streamAssignment = stream.getAssignmentAt(resStream.selectedPatternRef);
      expect(streamAssignment).toEqual(
        reqLegacy.catalog.effectSelections[resLegacy.selectedPatternRef].assignments
      );
    });

    it("全パターンにおいて、従来の一括エンコード結果とストリーミング用エンコード結果が全143次元で完全一致すること (問題B 特徴量完全同等性)", () => {
      const attackers = [createSoldierUnit("atk-0"), createSoldierUnit("atk-1")];
      const blockers = [createSoldierUnit("blk-0"), createSoldierUnit("blk-1"), createSoldierUnit("blk-2")];

      const reqLegacy = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components,
        { maxFullPatternLimit: Infinity }
      ).request;

      const reqStream = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components,
        { maxFullPatternLimit: 0 }
      ).request;

      const encodedLegacy = DecisionFeatureEncoder.encode(reqLegacy);
      const encoderContext = DecisionFeatureEncoder.createBlockAssignmentEncoderContext(reqStream);
      const stream = reqStream.blockAssignmentStream!;

      const testDna = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-feature-test" });
      (testDna.patternWeights as number[])[68] = 1.5; // effAssignSelectedCount
      (testDna.patternWeights as number[])[70] = -0.5; // effAssignSelectedSizeSum
      (testDna.patternWeights as number[])[83] = 2.0; // effCoverageRatio

      let idx = 0;
      for (const assignments of stream.iterateAssignments()) {
        const legacyPatternFeatures = encodedLegacy.patterns[idx].values;
        const streamingPatternFeatures = DecisionFeatureEncoder.encodeBlockAssignmentValues(
          assignments,
          stream.candidateCount, // 候補ブロッカー数を正規化分母として渡す
          encoderContext
        );

        // 143次元すべての要素が完全一致
        expect(streamingPatternFeatures.length).toBe(143);
        expect(legacyPatternFeatures.length).toBe(143);
        expect(streamingPatternFeatures).toEqual(legacyPatternFeatures);

        // 非ゼロDNAによるスコアの完全一致
        const scoreLegacy = GenomeScorer.scoreSinglePattern(encodedLegacy.context.values, legacyPatternFeatures, testDna);
        const scoreStream = GenomeScorer.scoreSinglePattern(encodedLegacy.context.values, streamingPatternFeatures, testDna);
        expect(scoreStream).toBeCloseTo(scoreLegacy, 10);
        idx++;
      }
      expect(idx).toBe(27);
    });

    it("全重みゼロ（全スコア完全同点）の場合に、最小インデックス (先頭手 index 0) が厳格に選択されること", () => {
      const attackers = [createSoldierUnit("atk-0")];
      const blockers = [createSoldierUnit("blk-0"), createSoldierUnit("blk-1")];
      const zeroDna = DecisionDNACodec.createZeroDecisionDNA({ id: "zero" });

      const reqStream = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components,
        { maxFullPatternLimit: 0 }
      ).request;

      const policy = new GenomePolicy(zeroDna);
      const res = policy.choose(reqStream);
      expect(res.selectedPatternRef).toBe(0); // 厳格なタイブレーク契約
    });

    it("非有限重み (NaN / Infinity) が与えられた場合に Fail-Closed 例外をスローすること", () => {
      const attackers = [createSoldierUnit("atk-0")];
      const blockers = [createSoldierUnit("blk-0")];

      const corruptedDna = DecisionDNACodec.createZeroDecisionDNA({ id: "corrupt" });
      (corruptedDna.patternWeights as number[])[0] = NaN;

      const reqStream = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components,
        { maxFullPatternLimit: 0 }
      ).request;

      // コンストラクタ時の Fail-Closed 検証 (DecisionDNAValidationError)
      expect(() => new GenomePolicy(corruptedDna)).toThrowError(DecisionDNAValidationError);

      // スコア計算時の非有限数 Fail-Closed 検証 (DecisionDNAExecutionError)
      const validDna = DecisionDNACodec.createZeroDecisionDNA({ id: "valid" });
      const contextValues = new Array(163).fill(0);
      const pValues = new Array(143).fill(0);
      pValues[0] = Infinity;
      expect(() => GenomeScorer.scoreSinglePattern(contextValues, pValues, validDna)).toThrowError(
        DecisionDNAExecutionError
      );
    });
  });

  // ===========================================================================
  // C. 大規模テスト (A=4, S=7 / A=4, S=8 / A=4, S=9)
  // ===========================================================================
  describe("C. 大規模テスト (A=4, S=7, S=8, S=9) と実機 GenomePolicy 評価速度測定", () => {
    it("A=4, S=7 (78,125 件): 全合法手を 1 手も切り捨てずに GenomePolicy で全件ストリーミング評価できること", () => {
      const attackers = Array.from({ length: 4 }, (_, i) => createSoldierUnit(`atk-${i}`));
      const blockers = Array.from({ length: 7 }, (_, i) => createSoldierUnit(`blk-${i}`));
      const dna = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-large-7" });
      (dna.patternWeights as number[])[68] = 0.5;

      const reqStream = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components,
        { maxFullPatternLimit: 0 }
      ).request;

      expect(reqStream.blockAssignmentStream?.patternCount).toBe(78125); // (4+1)^7 = 78,125

      const policy = new GenomePolicy(dna);
      const memBefore = process.memoryUsage().heapUsed;
      const t0 = performance.now();
      const res = policy.choose(reqStream);
      const elapsedMs = performance.now() - t0;
      const memDeltaMb = (process.memoryUsage().heapUsed - memBefore) / 1024 / 1024;

      console.log(`\n[LARGE BENCHMARK A=4, S=7 (78,125 patterns)]`);
      console.log(`  Elapsed: ${elapsedMs.toFixed(2)}ms`);
      console.log(`  Throughput: ${(78125 / (elapsedMs / 1000)).toFixed(0)} evaluations/sec`);
      console.log(`  Heap delta: ${memDeltaMb.toFixed(3)} MB`);
      console.log(`  Selected PatternRef: ${res.selectedPatternRef}`);

      expect(res.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(res.selectedPatternRef).toBeLessThan(78125);
      expect(reqStream.blockAssignmentStream?.getAssignmentAt(res.selectedPatternRef)).toBeDefined();
    });

    it("A=4, S=8 (390,625 件): 巨大合法手空間をメモリ破綻なく高速に全件評価できること", () => {
      const attackers = Array.from({ length: 4 }, (_, i) => createSoldierUnit(`atk-${i}`));
      const blockers = Array.from({ length: 8 }, (_, i) => createSoldierUnit(`blk-${i}`));
      const dna = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-large-8" });
      (dna.patternWeights as number[])[68] = 1.0;

      const reqStream = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components,
        { maxFullPatternLimit: 0 }
      ).request;

      expect(reqStream.blockAssignmentStream?.patternCount).toBe(390625); // (4+1)^8 = 390,625

      const policy = new GenomePolicy(dna);
      const t0 = performance.now();
      const res = policy.choose(reqStream);
      const elapsedMs = performance.now() - t0;

      console.log(`\n[LARGE BENCHMARK A=4, S=8 (390,625 patterns)]`);
      console.log(`  Elapsed: ${elapsedMs.toFixed(2)}ms`);
      console.log(`  Throughput: ${(390625 / (elapsedMs / 1000)).toFixed(0)} evaluations/sec`);
      console.log(`  Selected PatternRef: ${res.selectedPatternRef}`);

      expect(res.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(res.selectedPatternRef).toBeLessThan(390625);
    });
  });

  // ===========================================================================
  // D. 実機統合テスト (GameSession)
  // ===========================================================================
  describe("D. 実機統合テスト (GameSession と Core 状態遷移の検証)", () => {
    it("従来方式で選んだパターンとストリーミング方式で選んだ同一パターンのゲーム解決結果が 100% 一致すること", () => {
      const createMatchState = () => ({
        version: 1,
        matchId: "match-test",
        turn: 1,
        phase: "main",
        activePlayerKey: "p1",
        players: {
          p1: {
            playerKey: "p1",
            life: 20,
            field: [
              {
                unitId: "soldier-atk",
                kind: "一般兵",
                componentId: "character.soldier",
                state: "drive",
                cards: [{ id: "c-atk", suit: "S", rank: "8", value: 8 }],
                labels: ["攻撃", "防御"],
                battle: { role: "attacker", targetPlayerKey: "p2" },
              },
            ],
            graveyard: [],
          },
          p2: {
            playerKey: "p2",
            life: 20,
            field: [
              {
                unitId: "soldier-b1",
                kind: "一般兵",
                componentId: "character.soldier",
                state: "charge",
                cards: [{ id: "c-b1", suit: "C", rank: "3", value: 3 }],
                labels: ["防御"],
              },
              {
                unitId: "soldier-b2",
                kind: "一般兵",
                componentId: "character.soldier",
                state: "charge",
                cards: [{ id: "c-b2", suit: "D", rank: "4", value: 4 }],
                labels: ["防御"],
              },
            ],
            graveyard: [],
          },
        },
      });

      const blockAction = rulePackage.actions.find((a: any) => a.id === "action.block");
      const mockReq: any = {
        id: "req-block-test",
        actionId: "action.block",
        controller: "p2",
        definitionOwner: "p2",
        status: "resolving",
        action: blockAction,
      };

      const state1 = createMatchState();
      const state2 = createMatchState();

      // 従来方式
      const legacyResult = LegalPatternGenerator.generateBlockAssignmentDecision(
        state1,
        "p2",
        mockReq,
        "selectBlockAssignments",
        state1.players.p1.field,
        state1.players.p2.field,
        rulePackage.components,
        { maxFullPatternLimit: Infinity }
      );
      const targetLegacySel = legacyResult.request.catalog.effectSelections.find(
        (es) => es.assignments?.[0]?.selectedUnitIds.length === 2
      )!;

      // ストリーミング方式
      const streamProvider = LegalPatternGenerator.createBlockAssignmentStreamProvider(
        state2.players.p1.field,
        state2.players.p2.field,
        rulePackage.components
      );
      let targetStreamIndex = -1;
      let targetStreamSel: UnitAssignment[] | null = null;
      let idx = 0;
      for (const a of streamProvider.iterateAssignments()) {
        if (a[0]?.selectedUnitIds.length === 2) {
          targetStreamSel = a;
          targetStreamIndex = idx;
          break;
        }
        idx++;
      }

      expect(targetStreamSel).not.toBeNull();
      expect(targetStreamSel).toEqual(targetLegacySel.assignments);

      const registry = new CommandRegistry();
      TurnManager.initializeToMain(state1 as any, "p1");
      TurnManager.initializeToMain(state2 as any, "p1");

      const context1: CommandContext = {
        state: state1 as any,
        playerKey: "p2",
        selections: { blocks: targetLegacySel.assignments },
        actions: rulePackage.actions,
        components: rulePackage.components,
      };
      const context2: CommandContext = {
        state: state2 as any,
        playerKey: "p2",
        selections: { blocks: targetStreamSel! },
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      registry.createRequest(blockAction, context1);
      registry.resolveTopRequest(context1);

      registry.createRequest(blockAction, context2);
      registry.resolveTopRequest(context2);

      const djAction = rulePackage.actions.find((a: any) => a.id === "action.damageJudge")!;
      const djContext1: CommandContext = {
        state: state1 as any,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };
      const djContext2: CommandContext = {
        state: state2 as any,
        playerKey: "p1",
        actions: rulePackage.actions,
        components: rulePackage.components,
      };

      registry.createRequest(djAction, djContext1);
      registry.resolveTopRequest(djContext1);

      registry.createRequest(djAction, djContext2);
      registry.resolveTopRequest(djContext2);

      // 結果の完全一致を検証
      expect(state1.players.p1.life).toBe(state2.players.p1.life);
      expect(state1.players.p2.life).toBe(state2.players.p2.life);
      expect(state1.players.p1.graveyard?.map((u: any) => u.unitId)).toEqual(
        state2.players.p1.graveyard?.map((u: any) => u.unitId)
      );
      expect(state1.players.p2.graveyard?.map((u: any) => u.unitId)).toEqual(
        state2.players.p2.graveyard?.map((u: any) => u.unitId)
      );
      expect(state1.players.p1.field.map((u: any) => u.unitId)).toEqual(
        state2.players.p1.field.map((u: any) => u.unitId)
      );
      expect(state1.players.p2.field.map((u: any) => u.unitId)).toEqual(
        state2.players.p2.field.map((u: any) => u.unitId)
      );
    });

    it("256件超のストリーミングブロック局面において、GenomePolicyが先頭以外の選択手 (selectedPatternRef >= 1) をGameSessionに送信し正常解決すること (問題C 実機統合テスト)", () => {
      const { session, blockStep } = createLargeBattleSession();
      expect(blockStep.type).toBe("WAITING_FOR_DECISION");
      const req = getReq(blockStep);
      expect(req.blockAssignmentStream).toBeDefined();
      expect(req.blockAssignmentStream?.patternCount).toBe(1024); // (3+1)^5 = 1024
      expect(req.patterns.length).toBe(0); // ストリーミングモードのため一括生成なし

      // ブロッカー割り当て数を高く評価する DNA (先頭の 0体ブロック index 0 を絶対に選ばない)
      const dna = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-active-block" });
      (dna.patternWeights as number[])[73] = 5.0; // effect_assigned_unit_total
      (dna.patternWeights as number[])[127] = 5.0; // effect_assignment_selected_count

      const policy = new GenomePolicy(dna);
      const res = policy.choose(req);

      // 先頭以外の手 (selectedPatternRef >= 1) が選択されていることを検証
      expect(res.selectedPatternRef).toBeGreaterThan(0);
      expect(res.selectedPatternRef).toBeLessThan(1024);

      // Core の session.submitDecision に直接回答を渡す
      const nextStep = session.submitDecision(res);

      // PatternExecutor の検証を通過し、ブロック処理が正常に進むこと
      expect(nextStep).toBeDefined();

      // ゲームを終了または進行させ、状態遷移が正常に完了すること
      const followUpStep = session.advance();
      expect(followUpStep).toBeDefined();
    });

    it("ストリーミング判断待機中にSnapshotを保存・復元し、同一の合法手を選択・正常解決できること (問題D Snapshot契約)", () => {
      const { session, blockStep } = createLargeBattleSession();
      const req = getReq(blockStep);

      // スナップショットキャプチャ & JSON シリアライズ/デシリアライズ & 復元
      const snapshot = session.createSnapshot();
      const json = GameSessionSnapshotCodec.serialize(snapshot);
      const restoredSnapshot = GameSessionSnapshotCodec.deserialize(json);
      const restoredSession = GameSession.fromSnapshot(restoredSnapshot, rulePackage);

      // 復元された pendingDecision のストリーミングプロバイダが再構築されていること
      const restoredReq = restoredSession.pendingDecision;
      expect(restoredReq).toBeDefined();
      expect(restoredReq?.blockAssignmentStream).toBeDefined();
      expect(restoredReq?.blockAssignmentStream?.patternCount).toBe(1024);

      // 復元前後のプロバイダから取得できる割り当てが完全一致すること
      const originalAssignments = req.blockAssignmentStream?.getAssignmentAt(42);
      const restoredAssignments = restoredReq?.blockAssignmentStream?.getAssignmentAt(42);
      expect(restoredAssignments).toEqual(originalAssignments);

      // 復元されたセッションに Policy からの決定を渡して正常解決すること
      const dna = DecisionDNACodec.createZeroDecisionDNA({ id: "dna-restore-test" });
      (dna.patternWeights as number[])[73] = 3.0; // effect_assigned_unit_total
      const policy = new GenomePolicy(dna);
      const res = policy.choose(restoredReq!);

      const submitStep = restoredSession.submitDecision(res);
      expect(submitStep).toBeDefined();
    });

    it("FirstLegalPolicyおよびRandomPolicyがGameSessionで正常にブロック判断を送信・解決できること", () => {
      // FirstLegalPolicy (index 0 選択)
      {
        const { session, blockStep } = createLargeBattleSession();
        const firstLegal = new FirstLegalPolicy();
        const res = firstLegal.choose(getReq(blockStep));
        expect(res.selectedPatternRef).toBe(0);

        const nextStep = session.submitDecision(res);
        expect(nextStep).toBeDefined();
      }

      // RandomPolicy (一様ランダム 0..1023 選択)
      {
        const { session, blockStep } = createLargeBattleSession();
        const randomPolicy = new RandomPolicy(12345);
        const res = randomPolicy.choose(getReq(blockStep));
        expect(res.selectedPatternRef).toBeGreaterThanOrEqual(0);
        expect(res.selectedPatternRef).toBeLessThan(1024);

        const nextStep = session.submitDecision(res);
        expect(nextStep).toBeDefined();
      }
    });
  });

  // ===========================================================================
  // E. 監査・異常系 (Fail-Closed)
  // ===========================================================================
  describe("E. 監査・異常系 (Fail-Closed)", () => {
    it("FirstLegalPolicy: ストリーミングプロバイダが存在する場合にインデックス 0 を選択すること", () => {
      const attackers = [createSoldierUnit("atk-0")];
      const blockers = [createSoldierUnit("blk-0")];

      const reqStream = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components,
        { maxFullPatternLimit: 0 }
      ).request;

      const firstLegal = new FirstLegalPolicy();
      const res = firstLegal.choose(reqStream);
      expect(res.selectedPatternRef).toBe(0);
      expect(reqStream.blockAssignmentStream?.getAssignmentAt(0)).toEqual([
        { sourceUnitId: "atk-0", selectedUnitIds: [] },
      ]);
    });

    it("RandomPolicy: ストリーミングプロバイダが存在する場合に全パターン数 N の一様ランダムから選択すること", () => {
      const attackers = [createSoldierUnit("atk-0")];
      const blockers = [createSoldierUnit("blk-0"), createSoldierUnit("blk-1")];

      const reqStream = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components,
        { maxFullPatternLimit: 0 }
      ).request;

      const randomPolicy = new RandomPolicy(42);
      const res = randomPolicy.choose(reqStream);
      expect(res.selectedPatternRef).toBeGreaterThanOrEqual(0);
      expect(res.selectedPatternRef).toBeLessThan(4);
      expect(reqStream.blockAssignmentStream?.getAssignmentAt(res.selectedPatternRef)).toBeDefined();
    });

    it("改ざんされたインデックスや範囲外の回答に対してPatternExecutorおよびGameSessionがFail-Closed例外をスローすること", () => {
      const { session, blockStep } = createLargeBattleSession();
      const req = getReq(blockStep);

      // 負数インデックス
      expect(() => {
        session.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: -1,
        });
      }).toThrowError(/selectedPatternRef が範囲外です/);

      // 上限超過インデックス (1024)
      expect(() => {
        session.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 1024,
        });
      }).toThrowError(/selectedPatternRef が範囲外です/);

      // 非整数インデックス (1.5)
      expect(() => {
        session.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 1.5,
        });
      }).toThrowError(/selectedPatternRef が(範囲外|安全な整数ではありません)/);

      // NaN インデックス
      expect(() => {
        session.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: NaN,
        });
      }).toThrowError(/selectedPatternRef が(範囲外|安全な整数ではありません)/);
    });

    it("SimulationRunner がストリーミング意思決定を空集合とせず正確な総数と選択サマリーを記録すること (問題D 対戦ログ)", () => {
      const { session, blockStep } = createLargeBattleSession();
      const req = getReq(blockStep);

      const policy = new FirstLegalPolicy();
      const policies = {
        p1: policy,
        p2: policy,
      };

      const result = SimulationRunner.run(session, policies, { maxDecisions: 10 });
      expect(result.decisionTrace.length).toBeGreaterThan(0);

      // ストリーミングブロック判断のトレースレコードを検証
      const streamRecord = result.decisionTrace.find((r) => r.isStreaming);
      expect(streamRecord).toBeDefined();
      expect(streamRecord?.totalLegalPatternCount).toBe(1024);
      expect(streamRecord?.legalPatterns.length).toBe(0); // 1024件全件展開を抑止
      expect(streamRecord?.selectedPatternRef).toBe(0);
      expect(streamRecord?.assignmentsSummary).toBeDefined();
      expect(streamRecord?.selectedLogicalPatternKey).toContain("block-stream-0");
    });
  });

  // ===========================================================================
  // F. Snapshot復元・Canonical Log・事前検証の完全整合性 (R4)
  // ===========================================================================
  describe("F. Snapshot復元・Canonical Log・事前検証の完全整合性 (R4)", () => {
    it("1,024件の合法手を持つストリーミング判断で、Canonical Match Logの合法手数が1,024となり、isStreaming: true, legalPatternRefs: undefined であること (要件3, 5-5)", () => {
      const { session, blockStep } = createLargeBattleSession();
      const req = getReq(blockStep);
      expect(req.blockAssignmentStream?.patternCount).toBe(1024);

      const matchLog = session.getMatchLog();
      const decReqEvent = matchLog.events.find(
        (e: any) => e.type === "decision.requested" && e.decisionId === req.decisionId
      ) as any;

      expect(decReqEvent).toBeDefined();
      expect(decReqEvent.legalPatternCount).toBe(1024);
      expect(decReqEvent.isStreaming).toBe(true);
      expect(decReqEvent.legalPatternRefs).toBeUndefined();
    });

    it("Snapshot内の攻撃ユニットIDが存在しない場合、復元がFail-Closed例外をスローすること (要件2-1, 5-1)", () => {
      const { session } = createLargeBattleSession();
      const snapshot = session.createSnapshot();
      const parsed = JSON.parse(JSON.stringify(snapshot));
      parsed.session.pendingDecision.blockAssignmentStreamMeta.attackerUnitIds = ["non-existent-atk-id"];

      expect(() => {
        GameSession.fromSnapshot(parsed, rulePackage);
      }).toThrowError(/攻撃ユニットID.*見つかりません/);
    });

    it("Snapshot内のブロッカーIDが存在しない場合、復元がFail-Closed例外をスローすること (要件2-1, 5-2)", () => {
      const { session } = createLargeBattleSession();
      const snapshot = session.createSnapshot();
      const parsed = JSON.parse(JSON.stringify(snapshot));
      parsed.session.pendingDecision.blockAssignmentStreamMeta.candidateBlockerUnitIds = ["non-existent-blk-id"];

      expect(() => {
        GameSession.fromSnapshot(parsed, rulePackage);
      }).toThrowError(/ブロッカー候補ユニットID.*見つかりません/);
    });

    it("Snapshot内のIDが重複、または不正IDを含む場合、復元がFail-Closed例外をスローすること (要件2-2, 5-3)", () => {
      const { session } = createLargeBattleSession();
      const snapshot = session.createSnapshot();

      // 重複攻撃ユニットID
      {
        const parsed = JSON.parse(JSON.stringify(snapshot));
        const atkIds = parsed.session.pendingDecision.blockAssignmentStreamMeta.attackerUnitIds;
        parsed.session.pendingDecision.blockAssignmentStreamMeta.attackerUnitIds = [atkIds[0], atkIds[0]];
        expect(() => GameSession.fromSnapshot(parsed, rulePackage)).toThrowError(/attackerUnitIds に重複/);
      }

      // 重複ブロッカーID
      {
        const parsed = JSON.parse(JSON.stringify(snapshot));
        const blkIds = parsed.session.pendingDecision.blockAssignmentStreamMeta.candidateBlockerUnitIds;
        parsed.session.pendingDecision.blockAssignmentStreamMeta.candidateBlockerUnitIds = [blkIds[0], blkIds[0]];
        expect(() => GameSession.fromSnapshot(parsed, rulePackage)).toThrowError(/candidateBlockerUnitIds に重複/);
      }

      // 攻撃と防御で同一ID (交差)
      {
        const parsed = JSON.parse(JSON.stringify(snapshot));
        const atkIds = parsed.session.pendingDecision.blockAssignmentStreamMeta.attackerUnitIds;
        parsed.session.pendingDecision.blockAssignmentStreamMeta.candidateBlockerUnitIds = [atkIds[0]];
        expect(() => GameSession.fromSnapshot(parsed, rulePackage)).toThrowError(/同一ユニットID/);
      }

      // 空文字ID
      {
        const parsed = JSON.parse(JSON.stringify(snapshot));
        parsed.session.pendingDecision.blockAssignmentStreamMeta.attackerUnitIds = [""];
        expect(() => GameSession.fromSnapshot(parsed, rulePackage)).toThrowError(/不正な attackerUnitId/);
      }
    });

    it("Snapshot内のユニットが不正な所有者、領域、資格を持つ場合、復元がFail-Closed例外をスローすること (要件2-3, 5-3)", () => {
      const { session } = createLargeBattleSession();
      const snapshot = session.createSnapshot();

      // 攻撃ユニットを守備側フィールドのユニットに変更 (不正所有者)
      {
        const parsed = JSON.parse(JSON.stringify(snapshot));
        const blkIds = parsed.session.pendingDecision.blockAssignmentStreamMeta.candidateBlockerUnitIds;
        parsed.session.pendingDecision.blockAssignmentStreamMeta.candidateBlockerUnitIds = blkIds.slice(1);
        parsed.session.pendingDecision.blockAssignmentStreamMeta.attackerUnitIds = [blkIds[0]];
        expect(() => GameSession.fromSnapshot(parsed, rulePackage)).toThrowError(/相手プレイヤー.*のフィールドに見つかりません/);
      }

      // 攻撃ユニットの role が attacker ではない場合 (不正資格)
      {
        const parsed = JSON.parse(JSON.stringify(snapshot));
        const atkId = parsed.session.pendingDecision.blockAssignmentStreamMeta.attackerUnitIds[0];
        const atkUnit = parsed.gameState.players.p1.field.find((u: any) => u.unitId === atkId);
        atkUnit.battle.role = "defender";
        parsed.gameStateHash = StateHasher.hash(parsed.gameState);
        expect(() => GameSession.fromSnapshot(parsed, rulePackage)).toThrowError(/攻撃役割.*を持っていません/);
      }

      // ブロッカー候補が charge でも drive でもない (down状態など) 場合 (不正資格)
      {
        const parsed = JSON.parse(JSON.stringify(snapshot));
        const blkId = parsed.session.pendingDecision.blockAssignmentStreamMeta.candidateBlockerUnitIds[0];
        const blkUnit = parsed.gameState.players.p2.field.find((u: any) => u.unitId === blkId);
        blkUnit.state = "down";
        parsed.gameStateHash = StateHasher.hash(parsed.gameState);
        expect(() => GameSession.fromSnapshot(parsed, rulePackage)).toThrowError(/ブロック可能状態.*ではありません/);
      }
    });

    it("改ざんされたメタデータの patternCount と再構築結果が不一致の場合、復元がFail-Closed例外をスローすること (要件2-4, 5-4)", () => {
      const { session } = createLargeBattleSession();
      const snapshot = session.createSnapshot();
      const parsed = JSON.parse(JSON.stringify(snapshot));
      parsed.session.pendingDecision.blockAssignmentStreamMeta.patternCount = 999; // 改ざん

      expect(() => {
        GameSession.fromSnapshot(parsed, rulePackage);
      }).toThrowError(/合法手総数の不一致を検出しました/);
    });

    it("ストリーミング判断要求で blockAssignmentStreamMeta が欠落している場合、自動推測復元を禁止して例外をスローすること (要件2-6)", () => {
      const { session } = createLargeBattleSession();
      const snapshot = session.createSnapshot();
      const parsed = JSON.parse(JSON.stringify(snapshot));
      delete parsed.session.pendingDecision.blockAssignmentStreamMeta;

      expect(() => {
        GameSession.fromSnapshot(parsed, rulePackage);
      }).toThrowError(/blockAssignmentStreamMeta が存在しません。自動推測による復元は禁止されています/);
    });

    it("実体化不能な選択肢を submitDecision した場合、StateVersion、盤面状態、pendingDecision、ログが完全不変のままFail-Closed例外を送出すること (要件4, 5-6)", () => {
      const { session, blockStep } = createLargeBattleSession();
      const req = getReq(blockStep);

      const initialVersion = session.stateVersion;
      const initialPendingDecision = session.pendingDecision;
      const initialLogCount = session.getMatchLog().events.length;
      const initialPlayersStateJson = JSON.stringify(session.state.players);

      // 実体化不能な範囲外インデックス (1024)
      expect(() => {
        session.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: 1024,
        });
      }).toThrow();

      // 事前検証で失敗したため、StateVersion は完全に不変
      expect(session.stateVersion).toBe(initialVersion);
      // pendingDecision は完全に不変
      expect(session.pendingDecision).toBe(initialPendingDecision);
      // MatchLog に decision.responded が出力されていないこと (イベント数不変)
      expect(session.getMatchLog().events.length).toBe(initialLogCount);
      expect(
        session.getMatchLog().events.some((e: any) => e.type === "decision.responded" && e.decisionId === req.decisionId)
      ).toBe(false);
      // 盤面状態も完全に不変
      expect(JSON.stringify(session.state.players)).toBe(initialPlayersStateJson);
    });
  });
});
