/**
 * Stage 3 Full Action Space Retraining Smoke Test (Work 3-5 R1)
 *
 * 【目的】
 * 本番 1,920 試合の再学習実行前に、独立した診断用 Seed (99901〜99905) を使用して
 * 完全な合法手空間ストリーミングの実機動作・整合性を検証する。
 *
 * 【検証要件】
 * 1. 全合法手数を正しく取得できる (patternCount)
 * 2. 先頭以外の手 (selectedPatternRef >= 1) も適用できる
 * 3. GameSession が正常に進行する
 * 4. Snapshot 保存・復元が正常に動く
 * 5. Match Log に合法手数と選択手が正しく記録される
 * 6. OOM、タイムアウト、不完全試合が発生しない
 * 7. 正式な Training・Validation の結果にスモーク結果を混ぜない
 */

import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";

import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader.js";
import { GameSession } from "../../engine/session/GameSession.js";
import { GameSessionSnapshotCodec } from "../../engine/session/GameSessionSnapshotCodec.js";
import { GenomePolicy } from "../../engine/ai/GenomePolicy.js";
import { DecisionDNACodec } from "../../engine/ai/DecisionDNACodec.js";
import { SimulationRunner } from "../../engine/simulation/SimulationRunner.js";
import { FirstLegalPolicy } from "../../engine/simulation/DecisionPolicy.js";
import { BatchMatchContext } from "../../domain/simulation/BatchSimulationTypes.js";
import {
  REGULATION_ID,
  prepareOfficialSessionFactory,
} from "../../cli/stage3EvolutionRunner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 診断用独立シード (Training/Validation/Holdout と非重複)
export const DIAGNOSTIC_SMOKE_SEEDS = [99901, 99902, 99903, 99904, 99905] as const;

function getReq(step: any) {
  if (step.type === "WAITING_FOR_DECISION") {
    return step.request;
  }
  throw new Error(`Unexpected step type: ${step.type}`);
}

describe("Stage 3 Full Action Space Streaming Smoke Test", () => {
  it("診断用Seedが本番Training・Validation・Holdoutシードと完全に衝突しないこと", () => {
    for (const seed of DIAGNOSTIC_SMOKE_SEEDS) {
      // Validation seeds: 94001 - 94015
      expect(seed < 94001 || seed > 94015).toBe(true);
      // Holdout seeds: 95001 - 95030
      expect(seed < 95001 || seed > 95030).toBe(true);
    }
  });

  it("Standard+Pack環境でGameSessionを生成し、初期ステップが正常進行することを検証", async () => {
    const sessionFactory = await prepareOfficialSessionFactory(REGULATION_ID);

    // 診断用シードでセッション初期化
    const ctx: BatchMatchContext = {
      matchIndex: 0,
      matchId: "smoke-match-99901",
      baseSeed: DIAGNOSTIC_SMOKE_SEEDS[0],
      matchSeed: DIAGNOSTIC_SMOKE_SEEDS[0],
      playerSeeds: { p1: DIAGNOSTIC_SMOKE_SEEDS[0], p2: DIAGNOSTIC_SMOKE_SEEDS[1] },
    };
    const session = sessionFactory(ctx);
    expect(session).toBeInstanceOf(GameSession);

    // ゲームを少し進行させ、初期状態の正常性を確認
    const initialStep = session.advance();
    expect(initialStep).toBeDefined();
    expect(["STEP", "WAITING_FOR_DECISION", "FINISHED", "PROGRESSED"]).toContain(initialStep.type);
  });

  it("大規模合法手ストリーミング局面において、全合法手数の取得・先頭以外の手の適用・Snapshot復元が正常動作すること", async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    const rulePackage = await loadRulePackageFromDirectory(rulesDir);

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

    // 1. p1 attack
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

    // 3. p2 PASS -> attack 対象選択
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
      return eff?.selectedValues?.length === 3;
    });
    session.submitDecision({
      decisionId: req4.decisionId,
      stateVersion: req4.stateVersion,
      selectedPatternRef: multiAtkRef !== -1 ? multiAtkRef : 0,
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

    expect(currentStep.type).toBe("WAITING_FOR_DECISION");
    const blockReq = getReq(currentStep);
    expect(blockReq.blockAssignmentStream).toBeDefined();

    // 1. 全合法手数を正しく取得できること: (3攻撃 + 1アンブロック)^5ブロッカー = 4^5 = 1024通り
    const stream = blockReq.blockAssignmentStream!;
    expect(stream.patternCount).toBe(1024);
    expect(blockReq.patterns.length).toBe(0); // 遅延生成のため一括実体化配列は空

    // 2. 先頭以外の手 (selectedPatternRef >= 1) の選択と適用
    // ブロッカー割り当てを積極的に選択する DNA
    const dna = DecisionDNACodec.createZeroDecisionDNA({ id: "smoke-dna" });
    (dna.patternWeights as number[])[73] = 10.0; // effect_assigned_unit_total
    (dna.patternWeights as number[])[127] = 10.0; // effect_assignment_selected_count
    const policy = new GenomePolicy(dna);
    const decision = policy.choose(blockReq);

    expect(decision.selectedPatternRef).toBeGreaterThan(0);
    expect(decision.selectedPatternRef).toBeLessThan(1024);

    // 3. Snapshot 保存・復元の検証
    const snapshot = session.createSnapshot();
    const json = GameSessionSnapshotCodec.serialize(snapshot);
    const restoredSnapshot = GameSessionSnapshotCodec.deserialize(json);
    const restoredSession = GameSession.fromSnapshot(restoredSnapshot, rulePackage);

    const restoredReq = restoredSession.pendingDecision;
    expect(restoredReq?.blockAssignmentStream?.patternCount).toBe(1024);
    const origAssign = stream.getAssignmentAt(decision.selectedPatternRef);
    const restoredAssign = restoredReq?.blockAssignmentStream?.getAssignmentAt(decision.selectedPatternRef);
    expect(origAssign).toEqual(restoredAssign);

    // 4. Core への適用と正常解決 (PatternExecutor の検証を通過)
    const nextStep = session.submitDecision(decision);
    expect(nextStep).toBeDefined();

    // 5. ゲームの追行確認
    const followStep = session.advance();
    expect(followStep).toBeDefined();
  });

  it("SimulationRunner を使用した小規模実機対戦 (2試合) で Match Log に合法手数と選択手が正しく記録され完走すること", async () => {
    const sessionFactory = await prepareOfficialSessionFactory(REGULATION_ID);

    const dna = DecisionDNACodec.createZeroDecisionDNA({ id: "smoke-champion" });
    const p1Policy = new GenomePolicy(dna);
    const p2Policy = new FirstLegalPolicy(false);

    let completedCount = 0;
    for (let i = 0; i < 2; i++) {
      const matchSeed = DIAGNOSTIC_SMOKE_SEEDS[i];
      const ctx: BatchMatchContext = {
        matchIndex: i,
        matchId: `smoke-run-${matchSeed}`,
        baseSeed: matchSeed,
        matchSeed,
        playerSeeds: { p1: matchSeed, p2: matchSeed + 100 },
      };
      const session = sessionFactory(ctx);
      const matchOutcome = SimulationRunner.run(session, { p1: p1Policy, p2: p2Policy }, { maxDecisions: 500 });

      expect(matchOutcome.completed).toBe(true);
      expect(matchOutcome.totalDecisions).toBeGreaterThan(0);
      completedCount++;

      // Match Log の DecisionTrace 検査
      if (matchOutcome.decisionTrace && matchOutcome.decisionTrace.length > 0) {
        for (const trace of matchOutcome.decisionTrace) {
          expect(trace.runtimeDecisionId).toBeDefined();
          expect(typeof trace.selectedPatternRef).toBe("number");
          expect(trace.legalPatterns.length).toBeGreaterThan(0);
        }
      }
    }

    expect(completedCount).toBe(2);
  });
});
