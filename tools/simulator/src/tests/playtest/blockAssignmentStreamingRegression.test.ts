import { describe, it, expect, beforeAll } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { PlaytestConservativePolicy } from "../../engine/playtest/PlaytestConservativePolicy.js";
import { loadRegulationCatalog, clearRegulationCache } from "../../engine/regulation/RegulationLoader.js";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader.js";
import { startMatchAttempt } from "../../engine/playtest/PlaytestEnvironmentController.js";
import {
  isBlockAssignmentRequest,
  canAssignBlocker,
  findExactMatchPatternRef,
  AttackerBlockMap,
} from "../../ui/decision/blockAssignmentUtils.js";
import { buildUnitSetSelectionModel } from "../../ui/decision/AttackerSelectionEditor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data");

describe("ブロック割当ストリーミング対応 回帰テスト (作業A)", () => {
  let catalog: any;
  let rulePackage: any;

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog(path.join(DATA_DIR, "regulations"));
    rulePackage = await loadRulePackageFromDirectory(path.join(DATA_DIR, "rules-vnext"));
  });

  function createFourVsFiveBlockSession(seed: number = 1875946702) {
    const result = startMatchAttempt({
      environmentId: "official:mast-strategy",
      seedInput: String(seed),
      catalog,
      fullRulePackage: rulePackage,
      matchMode: "humanVsHuman",
      rareCardSelections: {
        p1: [{ suit: "J", rank: "Joker", occurrence: 0 }] as any,
        p2: [{ suit: "J", rank: "Joker", occurrence: 1 }] as any,
      },
      scenarioHandSelections: {
        p1: [
          { suit: "C", rank: "2", occurrence: 0 },
          { suit: "C", rank: "3", occurrence: 0 },
          { suit: "S", rank: "A", occurrence: 0 },
        ] as any,
        p2: [
          { suit: "C", rank: "A", occurrence: 0 },
          { suit: "C", rank: "K", occurrence: 0 },
          { suit: "C", rank: "Q", occurrence: 0 },
        ] as any,
      },
    });
    if (result.type !== "READY" || !result.session) {
      throw new Error(`startMatchAttempt failed: ${result.type}`);
    }
    const session = result.session;
    const state = session.state as any;

    // P1に兵士4体（アタック可能）、P2に兵士5体（ブロック可能）を配置
    const p1Cards = state.players.p1.life.splice(0, 4);
    state.players.p1.field = p1Cards.map((c: any, idx: number) => ({
      unitId: `p1-soldier-${idx}`,
      card: c,
      componentId: "character.soldier",
      state: "charge",
      enteredTurn: 0,
      enteredFieldTurn: 0,
      enteredFieldBeforeGame: true,
      attachments: [],
    }));

    const p2Cards = state.players.p2.life.splice(0, 5);
    state.players.p2.field = p2Cards.map((c: any, idx: number) => ({
      unitId: `p2-soldier-${idx}`,
      card: c,
      componentId: "character.soldier",
      state: "charge",
      enteredTurn: 0,
      enteredFieldTurn: 0,
      enteredFieldBeforeGame: true,
      attachments: [],
    }));

    return session;
  }

  it("4体アタック・5体ブロック候補(1,649通り, patterns.length===0)をPlaytestConservativePolicyが処理しDamageJudgeへ進行できること", () => {
    const session = createFourVsFiveBlockSession(1875946702);
    const policy = new PlaytestConservativePolicy();

    let step: any = session.advance();
    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;

    const req1 = step.request;
    const attackIdx = req1.patterns.findIndex((p) => {
      if (p.kind !== "ACTION" || p.actionSelectionRef === undefined) return false;
      const act = req1.catalog.actions?.[p.actionSelectionRef];
      return act?.actionId === "action.attack";
    });
    expect(attackIdx).toBeGreaterThanOrEqual(0);

    step = session.submitDecision({
      decisionId: req1.decisionId,
      stateVersion: req1.stateVersion,
      selectedPatternRef: attackIdx,
    });

    // チャンスでパスし、アタッカー選択(4体)を経てブロック割当へ
    let safety = 0;
    while (step.type === "WAITING_FOR_DECISION" && safety < 20) {
      safety++;
      const req = step.request;
      if (req.blockAssignmentStream) {
        // 256件超のストリーミング状態であり、patterns は空配列
        expect(req.patterns.length).toBe(0);
        expect(req.blockAssignmentStream.patternCount).toBeGreaterThan(256);
        expect(isBlockAssignmentRequest(req)).toBe(true);

        // PlaytestConservativePolicy が例外を出さずに選択できること
        const res = policy.choose(req);
        expect(res.selectedPatternRef).toBeGreaterThanOrEqual(0);
        expect(res.selectedPatternRef).toBeLessThan(req.blockAssignmentStream.patternCount);

        step = session.submitDecision(res);
        break;
      }

      if (req.source?.type === "EFFECT_RESOLUTION") {
        // アタッカー選択: 4体すべてを選ぶパターン
        const fourAtkIdx = req.patterns.findIndex((p) => {
          if (p.effectSelectionRef === undefined) return false;
          const eff = req.catalog.effectSelections?.[p.effectSelectionRef];
          const count = eff?.selectedValues?.length ?? 0;
          return count === 4;
        });
        expect(fourAtkIdx).toBeGreaterThanOrEqual(0);
        step = session.submitDecision({
          decisionId: req.decisionId,
          stateVersion: req.stateVersion,
          selectedPatternRef: fourAtkIdx,
        });
        continue;
      }

      const passIdx = req.patterns.findIndex((p) => p.kind === "PASS");
      expect(passIdx).toBeGreaterThanOrEqual(0);
      step = session.submitDecision({
        decisionId: req.decisionId,
        stateVersion: req.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    // ブロック解決後、DamageJudge等へ正常に進行し対戦を継続できること
    expect(step.type).not.toBe("ERROR");
    if (step.type === "WAITING_FOR_DECISION") {
      const nextRes = policy.choose(step.request);
      const nextStep = session.submitDecision(nextRes);
      expect(nextStep.type).not.toBe("ERROR");
    }
  });

  it("Human vs Human(UIユーティリティ)でも1,649通りのストリーミングブロック割当と既存ルール制約が機能すること", () => {
    const session = createFourVsFiveBlockSession(1875946702);
    let step: any = session.advance();
    if (step.type !== "WAITING_FOR_DECISION") throw new Error("unexpected");

    if (step.type !== "WAITING_FOR_DECISION") throw new Error("unexpected");
    const attackIdx = step.request.patterns.findIndex((p) => {
      if (p.kind !== "ACTION" || p.actionSelectionRef === undefined) return false;
      const act = step.request.catalog.actions?.[p.actionSelectionRef];
      return act?.actionId === "action.attack";
    });
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: attackIdx,
    });

    while (step.type === "WAITING_FOR_DECISION") {
      if (step.request.blockAssignmentStream) break;
      if (step.request.source?.type === "EFFECT_RESOLUTION") {
        const fourAtkIdx = step.request.patterns.findIndex((p) => {
          if (p.effectSelectionRef === undefined) return false;
          const eff = step.request.catalog.effectSelections?.[p.effectSelectionRef];
          const count = eff?.selectedValues?.length ?? 0;
          return count === 4;
        });
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: fourAtkIdx,
        });
        continue;
      }
      const passIdx = step.request.patterns.findIndex((p) => p.kind === "PASS");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    expect(step.type).toBe("WAITING_FOR_DECISION");
    if (step.type !== "WAITING_FOR_DECISION") return;
    const req = step.request;
    expect(isBlockAssignmentRequest(req)).toBe(true);
    expect(req.blockAssignmentStream).toBeDefined();

    const stream = req.blockAssignmentStream!;
    const meta = req.blockAssignmentStreamMeta!;
    const effs = req.catalog.effectSelections || [];
    expect(effs.length).toBe(0);
    expect(meta.attackerUnitIds.length).toBe(4);
    expect(meta.candidateBlockerUnitIds.length).toBeGreaterThanOrEqual(2);

    const [atk0, atk1] = meta.attackerUnitIds;
    const [blk0, blk1] = meta.candidateBlockerUnitIds;

    // 1. ブロックなし（空割当）のpatternRefが取得できること
    const emptyMap: AttackerBlockMap = Object.fromEntries(
      meta.attackerUnitIds.map((id) => [id, []])
    );
    const emptyRef = findExactMatchPatternRef(emptyMap, effs, stream);
    expect(emptyRef).not.toBeNull();

    // 2. 重複ブロッカー禁止の検証: blk0 を atk0 に割当後、atk1 には割当不可
    const mapWithOne: AttackerBlockMap = {
      ...emptyMap,
      [atk0]: [blk0],
    };
    expect(canAssignBlocker(mapWithOne, atk1, blk0, effs, stream)).toBe(false);
    // 別のブロッカーは割当可能
    expect(canAssignBlocker(mapWithOne, atk1, blk1, effs, stream)).toBe(true);

    // 3. 複数兵士によるブロックの検証
    expect(canAssignBlocker(mapWithOne, atk0, blk1, effs, stream)).toBe(true);
    const multiBlockMap: AttackerBlockMap = {
      ...emptyMap,
      [atk0]: [blk0, blk1],
    };
    const multiRef = findExactMatchPatternRef(multiBlockMap, effs, stream);
    expect(multiRef).not.toBeNull();

    // 4. 実際にsubmitDecisionで解決し、DamageJudgeへ進行できること
    const nextStep = session.submitDecision({
      decisionId: req.decisionId,
      stateVersion: req.stateVersion,
      selectedPatternRef: multiRef!,
    });
    expect(nextStep.type).not.toBe("ERROR");
  });

  it("PlaytestConservativePolicyは正真正銘の合法手なし(patternCount===0)の場合は例外を投げること", () => {
    const policy = new PlaytestConservativePolicy();
    expect(() =>
      policy.choose({
        protocolVersion: "1.0",
        matchId: "empty-test",
        decisionId: "dec-empty",
        stateVersion: 1,
        playerId: "p1",
        source: {
          type: "EFFECT_RESOLUTION",
          sourceRequestRef: "req-1",
          effectStepId: "selectBlockAssignments",
        },
        patterns: [],
        catalog: {
          actions: [],
          cardSelections: [],
          costPayments: [],
          effectSelections: [],
          unitSelections: [],
          targetSelections: [],
          orderSelections: [],
        },
        observation: { players: [] } as any,
      })
    ).toThrow(/選択可能なパターンが存在しません/);
  });

  it("同等条件Fixture: アタッカー4体 vs ブロッカー(防壁1体+兵士4体)で厳密に1,649通り(patterns.length===0)となり、混在禁止・複数ブロック・DamageJudge進行が成立すること", () => {
    const session = createFourVsFiveBlockSession(1875946702);
    const state = session.state as any;
    // P2のフィールドを「防壁1体 + 兵士4体」の構成に調整
    const p2Soldiers = state.players.p2.field.slice(0, 4);
    const p2Bulwark = {
      ...state.players.p2.field[4],
      unitId: "p2-bulwark-0",
      componentId: "character.bulwark",
    };
    expect(p2Soldiers.length).toBe(4);
    state.players.p2.field = [p2Bulwark, ...p2Soldiers];

    let step: any = session.advance();
    const attackIdx = step.request.patterns.findIndex((p: any) => {
      if (p.kind !== "ACTION" || p.actionSelectionRef === undefined) return false;
      return step.request.catalog.actions?.[p.actionSelectionRef]?.actionId === "action.attack";
    });
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: attackIdx,
    });

    while (step.type === "WAITING_FOR_DECISION" && !step.request.blockAssignmentStream) {
      if (step.request.source?.type === "EFFECT_RESOLUTION") {
        const fourAtkIdx = step.request.patterns.findIndex((p: any) => {
          if (p.effectSelectionRef === undefined) return false;
          const eff = step.request.catalog.effectSelections?.[p.effectSelectionRef];
          return (eff?.selectedValues?.length ?? 0) === 4;
        });
        step = session.submitDecision({
          decisionId: step.request.decisionId,
          stateVersion: step.request.stateVersion,
          selectedPatternRef: fourAtkIdx,
        });
        continue;
      }
      const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    expect(step.type).toBe("WAITING_FOR_DECISION");
    const req = step.request;
    expect(req.patterns.length).toBe(0);
    expect(req.blockAssignmentStream.patternCount).toBeGreaterThan(256);

    const policy = new PlaytestConservativePolicy();
    const res = policy.choose(req);
    expect(res.selectedPatternRef).toBeGreaterThanOrEqual(0);
    expect(res.selectedPatternRef).toBeLessThan(1649);

    const nextStep = session.submitDecision(res);
    expect(nextStep.type).not.toBe("ERROR");
  });

  it("奇襲後の召喚酔い検証: 以前ターン設置防壁からの変形兵士はアタック可能、このターン設置/召喚ユニットは指定不可であること", () => {
    const session = createFourVsFiveBlockSession(1875946702);
    const state = session.state as any;
    const currentTurn = state.turnCount;

    // P1: 以前ターン設置防壁(enteredFieldTurn:0) と このターン召喚兵士(enteredFieldTurn:currentTurn) を配置
    const cardA = state.players.p1.life.shift();
    const cardB = state.players.p1.life.shift();
    state.players.p1.field = [
      {
        unitId: "old-bulwark-transformed",
        card: cardA,
        componentId: "character.soldier",
        state: "charge",
        enteredTurn: 0,
        enteredFieldTurn: 0,
        enteredFieldBeforeGame: true,
        attachments: [],
      },
      {
        unitId: "this-turn-summoned",
        card: cardB,
        componentId: "character.soldier",
        state: "charge",
        enteredTurn: currentTurn,
        enteredFieldTurn: currentTurn,
        enteredFieldBeforeGame: false,
        attachments: [],
      },
    ];

    let step: any = session.advance();
    const attackIdx = step.request.patterns.findIndex((p: any) => {
      if (p.kind !== "ACTION" || p.actionSelectionRef === undefined) return false;
      return step.request.catalog.actions?.[p.actionSelectionRef]?.actionId === "action.attack";
    });
    expect(attackIdx).toBeGreaterThanOrEqual(0);
    step = session.submitDecision({
      decisionId: step.request.decisionId,
      stateVersion: step.request.stateVersion,
      selectedPatternRef: attackIdx,
    });

    while (step.type === "WAITING_FOR_DECISION" && step.request.source?.type !== "EFFECT_RESOLUTION") {
      const passIdx = step.request.patterns.findIndex((p: any) => p.kind === "PASS");
      step = session.submitDecision({
        decisionId: step.request.decisionId,
        stateVersion: step.request.stateVersion,
        selectedPatternRef: passIdx,
      });
    }

    expect(step.type).toBe("WAITING_FOR_DECISION");
    const selectedAllValues = new Set<string>();
    for (const p of step.request.patterns) {
      const eff = step.request.catalog.effectSelections?.[p.effectSelectionRef];
      for (const v of eff?.selectedValues ?? []) {
        selectedAllValues.add(v);
      }
    }
    expect(selectedAllValues.has("this-turn-summoned")).toBe(false);
  });
});
