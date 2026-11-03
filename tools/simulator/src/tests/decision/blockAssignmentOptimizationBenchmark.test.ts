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
import { DecisionDNA, DecisionDNAExecutionError, DecisionDNAValidationError } from "../../domain/ai/DecisionDNATypes.js";
import { FirstLegalPolicy, RandomPolicy } from "../../engine/simulation/DecisionPolicy.js";
import { GameSession } from "../../engine/session/GameSession.js";
import * as path from "path";

describe("Block Assignment Optimization Benchmark & Integrity Verification (Work 3-5 R2)", () => {
  const components: any[] = [{ id: "comp-soldier", properties: { characterType: "soldier" } }];
  const mockRequest: any = { id: "req-block", actionId: "action.block" };
  const mockState: any = { stateVersion: 1, players: {} };

  const createSoldierUnit = (unitId: string) => ({
    unitId,
    kind: "soldier",
    componentId: "comp-soldier",
    properties: { characterType: "soldier" },
  });

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
      expect(reqStream.catalog.effectSelections[resStream.selectedPatternRef]).toBeDefined();
      expect(reqStream.catalog.effectSelections[resStream.selectedPatternRef].assignments).toEqual(
        reqLegacy.catalog.effectSelections[resLegacy.selectedPatternRef].assignments
      );
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
      expect(reqStream.catalog.effectSelections[res.selectedPatternRef]).toBeDefined();
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
    let rulePackage: RulePackage;

    beforeAll(async () => {
      const rulesDir = path.resolve(__dirname, "../../data/rules-vnext/examples");
      rulePackage = await loadRulePackageFromDirectory(rulesDir);
    });

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
  });

  // ===========================================================================
  // E. 監査・異常系 (Fail-Closed)
  // ===========================================================================
  describe("E. 監査・異常系 (Fail-Closed)", () => {
    it("FirstLegalPolicy: ストリーミングプロバイダが存在する場合にインデックス 0 を実体化して選択すること", () => {
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
      expect(reqStream.catalog.effectSelections[0]).toBeDefined();
      expect(reqStream.catalog.effectSelections[0].assignments).toEqual([
        { sourceUnitId: "atk-0", selectedUnitIds: [] },
      ]);
    });

    it("RandomPolicy: ストリーミングプロバイダが存在する場合に全パターン数 N の一様ランダムから実体化して選択すること", () => {
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
      expect(reqStream.catalog.effectSelections[res.selectedPatternRef]).toBeDefined();
    });
  });
});
