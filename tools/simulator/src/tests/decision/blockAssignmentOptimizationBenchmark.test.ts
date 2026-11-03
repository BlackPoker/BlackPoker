import { describe, it, expect, beforeAll } from "vitest";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator.js";
import { CommandRegistry, CommandContext } from "../../engine/rules/CommandRegistry.js";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader.js";
import { RulePackage } from "../../domain/rules/RulePackage.js";
import { TurnManager } from "../../engine/rules/TurnManager.js";
import { isSoldierType } from "../../engine/rules/characterUtils.js";
import { LegalPattern } from "../../domain/decision/LegalPattern.js";
import { UnitAssignment, EffectSelection } from "../../domain/decision/DecisionCatalog.js";
import * as path from "path";

// =============================================================================
// 最適化方式（遅延ストリーミングジェネレータ）のプロトタイプ実装
// =============================================================================

/**
 * 組み合わせヘルパー（Core と完全に同一のロジック）
 */
function getCombinations<T>(arr: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...tail] = arr;
  const withHead = getCombinations(tail, k - 1).map((c) => [head, ...c]);
  const withoutHead = getCombinations(tail, k);
  return [...withHead, ...withoutHead];
}

/**
 * 遅延ストリーミングジェネレータ:
 * 従来方式とまったく同じ DFS 順序で UnitAssignment[] を 1件ずつ yield する。
 * メモリ上に巨大な配列を一切アロケートしない。
 */
function* iterateBlockAssignments(
  attackers: readonly any[],
  candidateBlockers: readonly any[],
  components: readonly any[] = []
): Generator<UnitAssignment[], void, unknown> {
  if (attackers.length === 0) {
    yield [];
    return;
  }

  const currentAssignments: UnitAssignment[] = [];
  const usedBlockerIds = new Set<string>();

  function* backtrack(attackerIndex: number): Generator<UnitAssignment[], void, unknown> {
    if (attackerIndex === attackers.length) {
      yield [...currentAssignments];
      return;
    }

    const attacker = attackers[attackerIndex];
    const available = candidateBlockers.filter((b) => !usedBlockerIds.has(b.unitId));

    // 1. 0体ブロック (常に合法)
    currentAssignments.push({
      sourceUnitId: attacker.unitId,
      selectedUnitIds: [],
    });
    yield* backtrack(attackerIndex + 1);
    currentAssignments.pop();

    // 2. 単一ブロッカー (任意の利用可能ブロッカー1体)
    for (const blocker of available) {
      currentAssignments.push({
        sourceUnitId: attacker.unitId,
        selectedUnitIds: [blocker.unitId],
      });
      usedBlockerIds.add(blocker.unitId);
      yield* backtrack(attackerIndex + 1);
      usedBlockerIds.delete(blocker.unitId);
      currentAssignments.pop();
    }

    // 3. 複数兵士ブロッカー (利用可能な兵士ユニットのみから 2体以上の組み合わせ)
    const availableSoldiers = available.filter((b) => isSoldierType(b, components));
    if (availableSoldiers.length >= 2) {
      for (let k = 2; k <= availableSoldiers.length; k++) {
        const soldierCombos = getCombinations(availableSoldiers, k);
        for (const combo of soldierCombos) {
          const soldierIds = combo.map((s) => s.unitId);
          currentAssignments.push({
            sourceUnitId: attacker.unitId,
            selectedUnitIds: soldierIds,
          });
          for (const id of soldierIds) usedBlockerIds.add(id);
          yield* backtrack(attackerIndex + 1);
          for (const id of soldierIds) usedBlockerIds.delete(id);
          currentAssignments.pop();
        }
      }
    }
  }

  yield* backtrack(0);
}

// =============================================================================
// テストスイート
// =============================================================================

describe("Block Assignment Optimization Benchmark & Integrity Verification", () => {
  const components: any[] = [{ id: "comp-soldier", properties: { characterType: "soldier" } }];
  const mockRequest: any = { id: "req-block", actionId: "action.block" };
  const mockState: any = { stateVersion: 1, players: {} };

  const createSoldierUnit = (unitId: string) => ({
    unitId,
    kind: "soldier",
    componentId: "comp-soldier",
    properties: { characterType: "soldier" },
  });

  describe("1. 小規模合法手集合における従来方式と遅延ストリーミング方式の完全同等性証明", () => {
    it("A=1, B=2 (兵士2体): 全4パターンが完全に同一の順序・同一の割り当てで生成されること", () => {
      const attackers = [createSoldierUnit("atk-0")];
      const blockers = [createSoldierUnit("blk-0"), createSoldierUnit("blk-1")];

      // 従来方式
      const legacyResult = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components
      );
      const legacyAssignments = legacyResult.request.catalog.effectSelections.map((es) => es.assignments);

      // 最適化方式
      const optimizedAssignments: UnitAssignment[][] = [];
      for (const a of iterateBlockAssignments(attackers, blockers, components)) {
        optimizedAssignments.push(a);
      }

      expect(optimizedAssignments.length).toBe(legacyAssignments.length);
      expect(optimizedAssignments.length).toBe(4); // 2^2 = 4

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

      // 従来方式
      const legacyResult = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components
      );
      const legacyAssignments = legacyResult.request.catalog.effectSelections.map((es) => es.assignments);

      // 最適化方式
      const optimizedAssignments: UnitAssignment[][] = [];
      for (const a of iterateBlockAssignments(attackers, blockers, components)) {
        optimizedAssignments.push(a);
      }

      expect(optimizedAssignments.length).toBe(legacyAssignments.length);
      expect(optimizedAssignments.length).toBe(27); // 3^3 = 27

      for (let i = 0; i < legacyAssignments.length; i++) {
        expect(optimizedAssignments[i]).toEqual(legacyAssignments[i]);
      }
    });

    it("複合ブロッカー (防壁1体 + 兵士2体): 単独ブロックのみ可能な防壁と複数ブロック可能な兵士が整合すること", () => {
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
        customComponents
      );
      const legacyAssignments = legacyResult.request.catalog.effectSelections.map((es) => es.assignments);

      const optimizedAssignments: UnitAssignment[][] = [];
      for (const a of iterateBlockAssignments(attackers, blockers, customComponents)) {
        optimizedAssignments.push(a);
      }

      expect(optimizedAssignments.length).toBe(legacyAssignments.length);
      // 0体(1) + 単独(3: bulwark, s0, s1) + 複数兵士(1: {s0, s1}) = 5パターン
      expect(optimizedAssignments.length).toBe(5);

      for (let i = 0; i < legacyAssignments.length; i++) {
        expect(optimizedAssignments[i]).toEqual(legacyAssignments[i]);
      }
    });
  });

  describe("2. 中規模・大規模ケースにおける網羅性・欠落なしの検証", () => {
    it("A=3, S=4 (4^4 = 256 パターン): 重複なし・一意性・期待件数の検証", () => {
      const attackers = Array.from({ length: 3 }, (_, i) => createSoldierUnit(`atk-${i}`));
      const blockers = Array.from({ length: 4 }, (_, i) => createSoldierUnit(`blk-${i}`));

      let count = 0;
      const signatures = new Set<string>();

      for (const assignment of iterateBlockAssignments(attackers, blockers, components)) {
        count++;
        // 各割り当ての一意シグネチャ (例: "atk-0:blk-0,blk-1|atk-1:|atk-2:blk-2")
        const sig = assignment
          .map((a) => `${a.sourceUnitId}:${[...a.selectedUnitIds].sort().join(",")}`)
          .join("|");
        signatures.add(sig);
      }

      expect(count).toBe(256); // (3+1)^4 = 256
      expect(signatures.size).toBe(256); // 全て一意（重複ゼロ）
    });

    it("A=3, S=6 (4^6 = 4,096 パターン): 欠落なく全 4,096 パターンが正しく列挙されること", () => {
      const attackers = Array.from({ length: 3 }, (_, i) => createSoldierUnit(`atk-${i}`));
      const blockers = Array.from({ length: 6 }, (_, i) => createSoldierUnit(`blk-${i}`));

      let count = 0;
      for (const _ of iterateBlockAssignments(attackers, blockers, components)) {
        count++;
      }

      expect(count).toBe(4096); // (3+1)^6 = 4096
    });
  });

  describe("3. 性能・メモリ消費の比較ベンチマーク", () => {
    it("A=3, S=5 (1,024 パターン): 従来方式 vs 最適化ストリーミング方式のメモリと速度比較", () => {
      const attackers = Array.from({ length: 3 }, (_, i) => createSoldierUnit(`atk-${i}`));
      const blockers = Array.from({ length: 5 }, (_, i) => createSoldierUnit(`blk-${i}`));

      // 従来方式（配列アロケーション）
      const t0 = performance.now();
      const legacyRes = LegalPatternGenerator.generateBlockAssignmentDecision(
        mockState,
        "p2",
        mockRequest,
        "step1",
        attackers,
        blockers,
        components
      );
      const legacyElapsedMs = performance.now() - t0;

      // 最適化方式（ストリーミング・最善手探索シミュレーション）
      const t1 = performance.now();
      let bestIndex = -1;
      let bestScore = -Infinity;
      let currentIndex = 0;

      // ダミースコア関数 (インライン評価)
      for (const assignment of iterateBlockAssignments(attackers, blockers, components)) {
        // 各割り当ての特徴量をその場で計算して argmax を更新（配列アロケートなし）
        const score = assignment.reduce((sum, a) => sum + a.selectedUnitIds.length, 0);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = currentIndex;
        }
        currentIndex++;
      }
      const streamElapsedMs = performance.now() - t1;

      console.log(`\n[BENCHMARK] A=3, S=5 (1,024 patterns):`);
      console.log(`  Legacy (All Array Alloc): ${legacyElapsedMs.toFixed(2)}ms`);
      console.log(`  Streaming (O(1) Memory):  ${streamElapsedMs.toFixed(2)}ms`);
      console.log(`  Total Evaluated: ${currentIndex} patterns, Best Index: ${bestIndex}, Best Score: ${bestScore}`);

      expect(currentIndex).toBe(1024);
      expect(legacyRes.request.patterns.length).toBe(1024);
    });

    it("A=4, S=7 (78,125 パターン): 従来方式なら巨大なメモリを食う局面をストリーミングで安全に完走できること", () => {
      const attackers = Array.from({ length: 4 }, (_, i) => createSoldierUnit(`atk-${i}`));
      const blockers = Array.from({ length: 7 }, (_, i) => createSoldierUnit(`blk-${i}`));

      const t0 = performance.now();
      let count = 0;
      let maxBlockersUsed = 0;

      for (const assignment of iterateBlockAssignments(attackers, blockers, components)) {
        count++;
        const used = assignment.reduce((sum, a) => sum + a.selectedUnitIds.length, 0);
        if (used > maxBlockersUsed) maxBlockersUsed = used;
      }
      const elapsedMs = performance.now() - t0;

      console.log(`\n[BENCHMARK] A=4, S=7 (78,125 patterns):`);
      console.log(`  Streaming Evaluated: ${count} patterns in ${elapsedMs.toFixed(2)}ms`);
      console.log(`  Throughput: ${(count / (elapsedMs / 1000)).toFixed(0)} patterns/sec`);
      console.log(`  Max Blockers Used in Single Pattern: ${maxBlockersUsed}`);

      expect(count).toBe(78125); // (4+1)^7 = 78,125
      expect(maxBlockersUsed).toBe(7);
    });
  });

  describe("4. ゲーム状態への適用結果（戦闘解決・ダメージ判定・墓地移動）の同一性検証", () => {
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

      // 従来方式で全パターン生成し、3番目のパターン（例: [b1, b2] 複数ブロック）を選択
      const legacyResult = LegalPatternGenerator.generateBlockAssignmentDecision(
        state1,
        "p2",
        mockReq,
        "selectBlockAssignments",
        state1.players.p1.field,
        state1.players.p2.field,
        rulePackage.components
      );
      // [soldier-b1, soldier-b2] を含むパターンを探す
      const targetLegacySel = legacyResult.request.catalog.effectSelections.find(
        (es) => es.assignments?.[0]?.selectedUnitIds.length === 2
      )!;

      // ストリーミング方式から同一インデックス・同一内容のパターンを取得
      let targetStreamSel: UnitAssignment[] | null = null;
      for (const a of iterateBlockAssignments(
        state2.players.p1.field,
        state2.players.p2.field,
        rulePackage.components
      )) {
        if (a[0]?.selectedUnitIds.length === 2) {
          targetStreamSel = a;
          break;
        }
      }

      expect(targetStreamSel).not.toBeNull();
      expect(targetStreamSel).toEqual(targetLegacySel.assignments);

      // 両者をそれぞれゲーム状態に適用
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
});
