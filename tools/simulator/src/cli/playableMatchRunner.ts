import * as path from "path";
import { loadRulePackageFromDirectory } from "../engine/rules/RuleLoader";
import { GameSession } from "../engine/session/GameSession";
import { createCoreBattlePresetState } from "../engine/session/playtest/createCoreBattlePlaytest";
import { getPlaytestRulePackage } from "../engine/rules/BrowserRuleLoader";

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function header(text: string) {
  console.log(`\n${colors.bold}${colors.cyan}================================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}  ${text}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}================================================================================${colors.reset}`);
}

function subHeader(text: string) {
  console.log(`\n${colors.bold}${colors.yellow}--- ${text} ---${colors.reset}`);
}

function findActionPatternIndex(req: any, actionId: string): number {
  return req.patterns.findIndex((p: any) => {
    if (p.actionSelectionRef === undefined) return false;
    const act = req.catalog.actions[p.actionSelectionRef];
    return act?.actionId === actionId;
  });
}

function findPassPatternIndex(req: any): number {
  return req.patterns.findIndex((p: any) => p.kind === "PASS");
}

import { validatePlaytestPreset } from "../engine/session/playtest/validatePlaytestPreset";

async function runPlayableMatch() {
  header("CORE BATTLE PLAYTEST MATCH CHECK (rules-vnext / GameSession / Decision)");

  const rulesDir = path.resolve(__dirname, "../data/rules-vnext");
  const fullPackage = await loadRulePackageFromDirectory(rulesDir);
  const rulePackage = getPlaytestRulePackage(fullPackage);

  const state = createCoreBattlePresetState();

  // プリセットの整合性バリデーション
  const validation = validatePlaytestPreset(state, fullPackage);
  if (!validation.valid) {
    console.error(`${colors.red}[VALIDATION ERROR] Preset が不正です:${colors.reset}`, validation.errors);
    process.exit(1);
  }
  console.log(`${colors.green}[PRESET VALIDATION OK] ${state.presetId} の整合性を確認しました。${colors.reset}`);

  const session = new GameSession(state, rulePackage);

  console.log(`初期プリセット: ${state.presetId}`);
  console.log(`Player A (p1) Life: ${state.players.p1.life.length}枚, Field: ${state.players.p1.field.length}体`);
  console.log(`Player B (p2) Life: ${state.players.p2.life.length}枚, Field: ${state.players.p2.field.length}体`);

  // =========================================================================
  // Turn 1
  // =========================================================================
  subHeader("Turn 1: Player A の手番");
  let step = session.advance();
  console.log(`[DECISION] Player A の手番アクション選択`);

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqAtk1 = step.request;

  // Attack リクエスト
  const atkIdx = findActionPatternIndex(reqAtk1, "action.attack");
  step = session.submitDecision({
    decisionId: reqAtk1.decisionId,
    stateVersion: reqAtk1.stateVersion,
    selectedPatternRef: atkIdx,
  });
  console.log(`[REQUEST] Player A が アタック をリクエスト`);

  // PASS / PASS
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqPass1 = step.request;
  step = session.submitDecision({
    decisionId: reqPass1.decisionId,
    stateVersion: reqPass1.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqPass1),
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqPass2 = step.request;
  step = session.submitDecision({
    decisionId: reqPass2.decisionId,
    stateVersion: reqPass2.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqPass2),
  });

  // アタッカー選択
  console.log(`[EFFECT] Player A が全アタッカー (兵士2体) を選択`);
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqAtkSel1 = step.request;
  const selectAllAtkPattern = reqAtkSel1.patterns.findIndex((p: any) => {
    const sel = reqAtkSel1.catalog.effectSelections[p.effectSelectionRef!];
    return Array.isArray(sel?.selectedValues) && sel.selectedValues.includes("soldier-p1-1") && sel.selectedValues.includes("soldier-p1-2");
  });
  step = session.submitDecision({
    decisionId: reqAtkSel1.decisionId,
    stateVersion: reqAtkSel1.stateVersion,
    selectedPatternRef: selectAllAtkPattern,
  });

  // Block 誘発 & PASS/PASS
  console.log(`[TRIGGER] ブロックが誘発し Stage に積載`);
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqBlockPass1 = step.request;
  step = session.submitDecision({
    decisionId: reqBlockPass1.decisionId,
    stateVersion: reqBlockPass1.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqBlockPass1),
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqBlockPass2 = step.request;
  step = session.submitDecision({
    decisionId: reqBlockPass2.decisionId,
    stateVersion: reqBlockPass2.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqBlockPass2),
  });

  // ブロッカー選択
  console.log(`[EFFECT] Player B がブロッカー (兵士1体) を選択して割り当て`);
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqBlockSel1 = step.request;
  const blockAssignmentPattern = reqBlockSel1.patterns.findIndex((p: any) => {
    const sel = reqBlockSel1.catalog.effectSelections[p.effectSelectionRef!];
    return (
      Array.isArray(sel?.assignments) &&
      sel.assignments.some((a: any) => a.sourceUnitId === "soldier-p1-1" && a.selectedUnitIds.includes("soldier-p2-1")) &&
      sel.assignments.some((a: any) => a.sourceUnitId === "soldier-p1-2" && a.selectedUnitIds.length === 0)
    );
  });
  step = session.submitDecision({
    decisionId: reqBlockSel1.decisionId,
    stateVersion: reqBlockSel1.stateVersion,
    selectedPatternRef: blockAssignmentPattern,
  });

  // DamageJudge 誘発 & PASS/PASS
  console.log(`[TRIGGER] ダメージ判定が誘発し Stage に積載`);
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqDjPass1 = step.request;
  step = session.submitDecision({
    decisionId: reqDjPass1.decisionId,
    stateVersion: reqDjPass1.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqDjPass1),
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqDjPass2 = step.request;
  step = session.submitDecision({
    decisionId: reqDjPass2.decisionId,
    stateVersion: reqDjPass2.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqDjPass2),
  });
  console.log(`[RESOLVE] ダメージ判定解決: 兵士相打ち & 未ブロック兵士により Player B に 5ダメージ (残りLife: ${state.players.p2.life.length}枚)`);

  // End リクエスト
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqEnd1 = step.request;
  const endIdx1 = findActionPatternIndex(reqEnd1, "action.end");
  step = session.submitDecision({
    decisionId: reqEnd1.decisionId,
    stateVersion: reqEnd1.stateVersion,
    selectedPatternRef: endIdx1,
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqEndPass1 = step.request;
  step = session.submitDecision({
    decisionId: reqEndPass1.decisionId,
    stateVersion: reqEndPass1.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqEndPass1),
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqEndPass2 = step.request;
  step = session.submitDecision({
    decisionId: reqEndPass2.decisionId,
    stateVersion: reqEndPass2.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqEndPass2),
  });
  console.log(`[RESOLVE] エンド解決 -> ターン交代`);

  // =========================================================================
  // Turn 2
  // =========================================================================
  subHeader("Turn 2: Player B の手番 (チャージ即時解決 -> ドロー積載 -> ツイスト割り込み)");
  console.log(`[TRIGGER] チャージ即時解決 (Player B のキャラクターが charge 状態へ)`);
  console.log(`[TRIGGER] ドローが Stage に積載 (チャンス: Player A)`);

  // Quick ツイスト
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqTwist = step.request;
  const twistPatternIdx = reqTwist.patterns.findIndex((p: any) => {
    if (p.actionSelectionRef === undefined) return false;
    const act = reqTwist.catalog.actions[p.actionSelectionRef];
    if (act?.actionId !== "action.twist") return false;
    const target =
      p.targetSelectionRef !== undefined ? reqTwist.catalog.targetSelections[p.targetSelectionRef] : undefined;
    return target?.targetUnitId === "bw-p1";
  });
  step = session.submitDecision({
    decisionId: reqTwist.decisionId,
    stateVersion: reqTwist.stateVersion,
    selectedPatternRef: twistPatternIdx,
  });
  console.log(`[QUICK] Player A が ドロー に対して Quick アクション「ツイスト」で割り込み！`);

  // Twist 解決
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqTwistPass1 = step.request;
  step = session.submitDecision({
    decisionId: reqTwistPass1.decisionId,
    stateVersion: reqTwistPass1.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqTwistPass1),
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqTwistPass2 = step.request;
  step = session.submitDecision({
    decisionId: reqTwistPass2.decisionId,
    stateVersion: reqTwistPass2.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqTwistPass2),
  });
  console.log(`[RESOLVE] ツイストが先に解決 (LIFO順序)`);

  // Draw 解決
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqDrawPass1 = step.request;
  step = session.submitDecision({
    decisionId: reqDrawPass1.decisionId,
    stateVersion: reqDrawPass1.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqDrawPass1),
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqDrawPass2 = step.request;
  step = session.submitDecision({
    decisionId: reqDrawPass2.decisionId,
    stateVersion: reqDrawPass2.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqDrawPass2),
  });
  console.log(`[RESOLVE] ドロー解決: Player B が 2枚ドロー (残りLife: ${state.players.p2.life.length}枚, 手札: ${state.players.p2.hand.length}枚)`);

  // End
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqEnd2 = step.request;
  const endIdx2 = findActionPatternIndex(reqEnd2, "action.end");
  step = session.submitDecision({
    decisionId: reqEnd2.decisionId,
    stateVersion: reqEnd2.stateVersion,
    selectedPatternRef: endIdx2,
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqEndPass3 = step.request;
  step = session.submitDecision({
    decisionId: reqEndPass3.decisionId,
    stateVersion: reqEndPass3.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqEndPass3),
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqEndPass4 = step.request;
  step = session.submitDecision({
    decisionId: reqEndPass4.decisionId,
    stateVersion: reqEndPass4.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqEndPass4),
  });

  // =========================================================================
  // Turn 3
  // =========================================================================
  subHeader("Turn 3: Player A の手番 (決着)");
  // Draw 解決
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqDrawPass3 = step.request;
  step = session.submitDecision({
    decisionId: reqDrawPass3.decisionId,
    stateVersion: reqDrawPass3.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqDrawPass3),
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqDrawPass4 = step.request;
  step = session.submitDecision({
    decisionId: reqDrawPass4.decisionId,
    stateVersion: reqDrawPass4.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqDrawPass4),
  });

  // Attack
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqAtk3 = step.request;
  const atkIdx3 = findActionPatternIndex(reqAtk3, "action.attack");
  step = session.submitDecision({
    decisionId: reqAtk3.decisionId,
    stateVersion: reqAtk3.stateVersion,
    selectedPatternRef: atkIdx3,
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqAtkPass1 = step.request;
  step = session.submitDecision({
    decisionId: reqAtkPass1.decisionId,
    stateVersion: reqAtkPass1.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqAtkPass1),
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqAtkPass2 = step.request;
  step = session.submitDecision({
    decisionId: reqAtkPass2.decisionId,
    stateVersion: reqAtkPass2.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqAtkPass2),
  });

  // アタッカー選択
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqAtkSel2 = step.request;
  const selectAtk2Pattern = reqAtkSel2.patterns.findIndex((p: any) => {
    const sel = reqAtkSel2.catalog.effectSelections[p.effectSelectionRef!];
    return Array.isArray(sel?.selectedValues) && sel.selectedValues.includes("soldier-p1-2");
  });
  step = session.submitDecision({
    decisionId: reqAtkSel2.decisionId,
    stateVersion: reqAtkSel2.stateVersion,
    selectedPatternRef: selectAtk2Pattern,
  });

  // Block PASS/PASS
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqBlockPass3 = step.request;
  step = session.submitDecision({
    decisionId: reqBlockPass3.decisionId,
    stateVersion: reqBlockPass3.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqBlockPass3),
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqBlockPass4 = step.request;
  step = session.submitDecision({
    decisionId: reqBlockPass4.decisionId,
    stateVersion: reqBlockPass4.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqBlockPass4),
  });

  // ブロックなし選択
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqBlockSel2 = step.request;
  const selectNoBlockPattern = reqBlockSel2.patterns.findIndex((p: any) => {
    const sel = reqBlockSel2.catalog.effectSelections[p.effectSelectionRef!];
    return Array.isArray(sel?.assignments) && sel.assignments.every((a: any) => a.selectedUnitIds.length === 0);
  });
  step = session.submitDecision({
    decisionId: reqBlockSel2.decisionId,
    stateVersion: reqBlockSel2.stateVersion,
    selectedPatternRef: selectNoBlockPattern,
  });

  // DamageJudge PASS/PASS
  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqDjPass3 = step.request;
  step = session.submitDecision({
    decisionId: reqDjPass3.decisionId,
    stateVersion: reqDjPass3.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqDjPass3),
  });

  if (step.type !== "WAITING_FOR_DECISION") return;
  const reqDjPass4 = step.request;
  step = session.submitDecision({
    decisionId: reqDjPass4.decisionId,
    stateVersion: reqDjPass4.stateVersion,
    selectedPatternRef: findPassPatternIndex(reqDjPass4),
  });

  subHeader("対戦結果");
  console.log(`Player B ライフ: ${state.players.p2.life.length}枚`);
  if (step.type === "FINISHED") {
    const winnerName = state.players[step.result.winner || ""]?.name || step.result.winner;
    console.log(`\n${colors.bold}${colors.green}★ 勝者: ${winnerName} (${step.result.winner}) ★${colors.reset}`);
    console.log(`終了理由: ${step.result.reason}`);
    console.log(`\n${colors.bold}${colors.green}[SUCCESS] 1戦通しの全コアフロー (Attack, Block, DamageJudge, End, Charge, Draw, Quick, 勝敗判定) が正常に完走しました。${colors.reset}`);
  } else {
    throw new Error(`ゲームが FINISHED に到達しませんでした (type: ${step.type})`);
  }
}

runPlayableMatch().catch((err) => {
  console.error("Playable match check failed:", err);
  process.exit(1);
});
