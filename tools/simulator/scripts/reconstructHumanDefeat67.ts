import { loadRulePackageForBrowser } from "../src/engine/rules/BrowserRuleLoader";
import { loadRegulationCatalogForBrowser } from "../src/engine/regulation/BrowserRegulationLoader";
import { startMatchAttempt, OFFICIAL_ENV_PREFIX } from "../src/engine/playtest/PlaytestEnvironmentController";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader";
import { DecisionFeatureEncoder } from "../src/engine/ai/DecisionFeatureEncoder";
import { GenomeScorer } from "../src/engine/ai/GenomeScorer";
import { DecisionRequest } from "../src/domain/decision/DecisionRequest";
import { GameSession, GameSessionStep } from "../src/engine/session/GameSession";
import { buildPlaytestDiagnosticBundleV1 } from "../src/ui/playtest/PlaytestDiagnosticBundle";
import { PlaytestDecisionTranscriptEntryV1 } from "../src/ui/playtest/PlaytestDecisionTranscript";
import * as fs from "fs";
import * as path from "path";

const fullRulePackage = loadRulePackageForBrowser();
const catalog = loadRegulationCatalogForBrowser();
const envId = `${OFFICIAL_ENV_PREFIX}standard-pack`;

const outcome = startMatchAttempt({
  environmentId: envId,
  seedInput: "4127992094",
  catalog,
  fullRulePackage,
});

if (outcome.type !== "READY") {
  console.error("Match start failed:", outcome);
  process.exit(1);
}

const session = outcome.session;
const aiPolicy = createGen8ChampionCandidatePolicy();
const dna = (aiPolicy as any).dna;

const decisionTranscript: PlaytestDecisionTranscriptEntryV1[] = [];
let decisionSeq = 0;
let step = outcome.initialStep;

function recordAndSubmit(
  actor: "human" | "policy" | "autoPass",
  playerId: "p1" | "p2",
  patternRef: number,
  desc: string
) {
  if (step.type !== "WAITING_FOR_DECISION") {
    throw new Error(`Cannot submit decision in step type: ${step.type}`);
  }
  decisionSeq++;
  const req = step.request;

  decisionTranscript.push({
    seq: decisionSeq,
    actor,
    playerId,
    decisionId: req.decisionId,
    stateVersion: req.stateVersion,
    response: {
      decisionId: req.decisionId,
      stateVersion: req.stateVersion,
      selectedPatternRef: patternRef,
    },
  });

  const pat = req.patterns[patternRef];
  const act = pat?.actionSelectionRef !== undefined ? req.catalog.actions[pat.actionSelectionRef] : undefined;
  console.log(`[Decision #${decisionSeq}] Turn ${session.state.turnCount} (${session.state.turnPlayer}) | ${actor.toUpperCase()} (${playerId}): #${patternRef} [${act?.actionId || pat?.kind}] ${pat?.patternId || ''} (${desc}) | Legal: ${req.patterns.length}`);

  step = session.submitDecision({
    decisionId: req.decisionId,
    stateVersion: req.stateVersion,
    selectedPatternRef: patternRef,
  });
}

function evaluateAI(req: DecisionRequest) {
  const features = DecisionFeatureEncoder.encode(req);
  const scored = GenomeScorer.score(features, dna);
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  return { sorted, best: sorted[0], scored, features };
}

console.log("================================================================================");
console.log(" Reconstructing Exact 67-Decision Human vs Gen 8 Match (Seed: 4127992094)");
console.log("================================================================================");

console.log("Outcome firstPlayer:", (outcome as any).firstPlayer);
console.log("Session turnPlayer:", session.state.turnPlayer);
console.log("Session turnCount:", session.state.turnCount);

// -----------------------------------------------------------------------------
// TURN 1: AI (P2 先攻)
// 1. action.attack (Pattern #0) -> C3兵士で攻撃
// 2. action.summonSoldier -> S10兵士召喚
// 3. action.end -> エンド（エース召喚・投擲なし）
// -----------------------------------------------------------------------------
console.log("\n--- TURN 1 ---");

// Step 1: AI attack
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const attRef = step.request.patterns.findIndex(p => p.actionSelectionRef !== undefined && step.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.attack");
  recordAndSubmit("policy", "p2", attRef, "AI attacks");
}

console.log("After attack decl - P1 Hand:", session.state.players.p1.hand.map((c: any) => `${c.suit}${c.rank}`));
console.log("After attack decl - P1 Life:", session.state.players.p1.life.map((c: any) => `${c.suit}${c.rank}`));
console.log("After attack decl - P1 Grave:", session.state.players.p1.grave.map((c: any) => `${c.suit}${c.rank}`));

// AI pass on attack queue
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes chance");
}
// Human pass on attack
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes (allows attack)");
}
// AI selects unit (C3 soldier)
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  recordAndSubmit("policy", "p2", 1, "AI selects C3 soldier");
}
// AI pass on block opportunity
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes");
}
// Human pass on block
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes on block");
}

console.log("=== BLOCKER SELECTION PATTERNS ===", JSON.stringify(step.request.patterns.map((p: any) => ({
  patternId: p.patternId,
  kind: p.kind
})), null, 2));

// Human blocker select SA (Ace) -> pat-block-2
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  recordAndSubmit("human", "p1", 2, "Human blocks with Ace SA (pat-block-2)");
}

// AI pass on damage judge
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes on damage judge");
}
// Human pass on damage judge
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes on damage judge");
}
// Human damage judge resolution (3 damage)
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  console.log("Before damage resolve - P1 Hand:", session.state.players.p1.hand.map((c: any) => `${c.suit}${c.rank}`));
  console.log("Before damage resolve - P1 Life:", session.state.players.p1.life.map((c: any) => `${c.suit}${c.rank}`));
  console.log("Before damage resolve - Request Patterns:", step.request.patterns.map(p => p.patternId));
  recordAndSubmit("human", "p1", 0, "Human resolves damage judge");
  console.log("After damage resolve - P1 Hand:", session.state.players.p1.hand.map((c: any) => `${c.suit}${c.rank}`));
  console.log("After damage resolve - P1 Life:", session.state.players.p1.life.map((c: any) => `${c.suit}${c.rank}`));
  console.log("After damage resolve - P1 Grave:", session.state.players.p1.grave.map((c: any) => `${c.suit}${c.rank}`));
}

// AI Turn 1 main: action.summonSoldier (S10)
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const s10Ref = step.request.patterns.findIndex(p => p.actionSelectionRef !== undefined && step.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.summonSoldier" && p.patternId.includes("S10"));
  recordAndSubmit("policy", "p2", s10Ref, "AI summons Soldier S10");
}
// AI pass on summon
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes");
}
// Human pass on summon
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes");
}

// AI Turn 1 main: action.end (投擲・エース召喚を行わずにエンド！)
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const endRef = step.request.patterns.findIndex(p => p.actionSelectionRef !== undefined && step.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.end");
  recordAndSubmit("policy", "p2", endRef, "AI ends Turn 1");
}
// AI pass on end
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes on end");
}
// Human pass on end -> Turn 1 ends
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes on end");
}

// -----------------------------------------------------------------------------
// TURN 2: Human (P1 後攻)
// 1. ドロー解決
// 2. 人間が ♦A＋♠K で死の槍を実行（対象: AIのS10兵士）
//    -> ユーザー指定事実: 最初の死の槍に対する合法手数は 69！
// 3. 人間が ♥K の英雄を召喚
// 4. エンド
// -----------------------------------------------------------------------------
console.log("\n--- TURN 2 ---");

// P1 draw stage pass
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes on draw");
}
// P2 draw pass
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes on draw");
}

// P1 メイン: ♦A + ♠K で死の槍（action.deathLance）を実行！
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const dlRef = step.request.patterns.findIndex(p => {
    if (p.actionSelectionRef === undefined) return false;
    const act = step.request.catalog.actions[p.actionSelectionRef];
    return act?.actionId === "action.deathLance" && p.patternId.includes("DA") && p.patternId.includes("SK") && p.patternId.includes("unit-p2-character.soldier-p2-c-S10");
  });
  recordAndSubmit("human", "p1", dlRef, "Human casts action.deathLance with ♦A + ♠K on AI S10 Soldier");
}
// P1 pass on deathLance
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes chance on deathLance");
}

// *** ユーザー指摘の検証点: 最初の死の槍に対する AI 合法手数は 69！ ***
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  console.log(`\n>>> [VERIFY AUDIT A] Legal patterns vs first deathLance: ${step.request.patterns.length} (Expected: 69)`);
  if (step.request.patterns.length === 69) {
    console.log("  >>> MATCHES USER EVIDENCE EXACTLY: 69 legal patterns! <<<");
  } else {
    console.warn(`  >>> MISMATCH: got ${step.request.patterns.length}, expected 69`);
  }
  // AI は PASS を選択
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes vs deathLance");
}

// P2 order selection for deathLance return
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  recordAndSubmit("policy", "p2", 0, "AI confirms card order for deathLance");
}

// 人間が防壁をセット (action.setBulwark)
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const setBwRef = step.request.patterns.findIndex(p => {
    if (p.actionSelectionRef === undefined) return false;
    return step.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.setBulwark";
  });
  recordAndSubmit("human", "p1", setBwRef, "Human casts action.setBulwark");
}
// 人間が防壁のカードを選択（例: H10）
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const h10Ref = step.request.patterns.findIndex(p => p.patternId.includes("H10"));
  recordAndSubmit("human", "p1", h10Ref !== -1 ? h10Ref : 0, "Human selects H10 as bulwark");
}

// 人間が ♥K の英雄を召喚 (action.summonHero)
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const hkHeroRef = step.request.patterns.findIndex(p => p.patternId.includes("summonHero") && p.patternId.includes("HK"));
  recordAndSubmit("human", "p1", hkHeroRef, "Human summons Hero (♥K, Size 13)");
}
// P1 pass on hero summon
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes on hero summon");
}
// P2 pass on hero summon
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes on hero summon");
}

// 人間 Turn 2 エンド
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const endRef = step.request.patterns.findIndex(p => p.actionSelectionRef !== undefined && step.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.end");
  recordAndSubmit("human", "p1", endRef, "Human ends Turn 2");
}
// P1 pass
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes on Turn 2 end");
}
// P2 pass -> Turn 2 ends
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes on Turn 2 end");
}

// -----------------------------------------------------------------------------
// TURN 3: AI (P2 先攻)
// 1. チャージ・ドロー解決
// 2. AI は攻撃を選択 (Turn 3 攻撃前の合法手数は 153！)
// 3. AI の ♣3 兵士がサイズ13の英雄（♥K）にブロックされて死亡
// 4. AI は ♣8 を兵士として召喚
// 5. AI エンド
// -----------------------------------------------------------------------------
console.log("\n--- TURN 3 ---");

// P2 draw pass
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes on draw");
}
// P1 draw pass
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes on draw");
}

// *** ユーザー指摘の検証点: Turn 3 攻撃前の合法手数は 153！ ***
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  console.log(`\n>>> [VERIFY AUDIT B] Turn 3 attack decision legal patterns: ${step.request.patterns.length} (Expected: 153)`);
  if (step.request.patterns.length === 153) {
    console.log("  >>> MATCHES USER EVIDENCE EXACTLY: 153 legal patterns! <<<");
  } else {
    console.warn(`  >>> MISMATCH: got ${step.request.patterns.length}, expected 153`);
  }
}




// P1 draw pass
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes on draw");
}

// *** ユーザー指定検証点: Turn 3 攻撃前の合法手数は 153！ ***
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  console.log(`\n>>> [VERIFY AUDIT B] Turn 3 AI Main Legal Patterns: ${step.request.patterns.length} (Expected: 153)`);
  if (step.request.patterns.length === 153) {
    console.log("  >>> MATCHES USER EVIDENCE EXACTLY: 153 legal patterns! <<<");
  } else {
    console.warn(`  >>> MISMATCH: got ${step.request.patterns.length}, expected 153`);
  }

  // AI は攻撃を選択
  const attRef = step.request.patterns.findIndex(p => p.actionSelectionRef !== undefined && step.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.attack");
  recordAndSubmit("policy", "p2", attRef, "AI attacks in Turn 3");
}
// AI pass on attack queue
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes chance");
}
// Human pass on attack queue
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes (allows attack resolution)");
}
// AI selects unit: ♣3 兵士 (soldier-p2-preset)
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  // C3 兵士単独、または C3 を含む選択
  const c3Ref = step.request.patterns.findIndex(p => p.patternId.includes("soldier-p2-preset") && !p.patternId.includes("unit-p2-character.soldier"));
  const choice = c3Ref >= 0 ? c3Ref : 1;
  recordAndSubmit("policy", "p2", choice, "AI selects ♣3 soldier to attack");
}
// AI pass on block
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes");
}
// Human pass on block stage (allows block resolution)
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes on block trigger");
}

// Human selects blocker unit: Size 13 Hero (♥K)
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  recordAndSubmit("human", "p1", 1, "Human selects Size 13 Hero (♥K) as blocker");
}
// AI pass on damage judge
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes on damage judge");
}
// Human pass on damage judge
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes on damage judge");
}

console.log("After damageJudge resolved - Current step:", step.type, (step as any).request?.playerId);
if (step.type === "WAITING_FOR_DECISION") {
  console.log("Turn 3 AI Hand:", session.state.players.p2.hand.map((c: any) => `${c.suit}${c.rank}`));
  console.log("Turn 3 AI Legal actions:", step.request.patterns.map((p: any) => {
    const act = p.actionSelectionRef !== undefined ? step.request.catalog.actions[p.actionSelectionRef] : undefined;
    return `${act?.actionId || p.kind}: ${p.patternId}`;
  }));
}

// 次に AI は ♣8 を兵士として召喚 (action.summonSoldier)
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const c8Ref = step.request.patterns.findIndex(p => p.actionSelectionRef !== undefined && step.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.summonSoldier" && p.patternId.includes("C8"));
  console.log("c8Ref:", c8Ref);
  recordAndSubmit("policy", "p2", c8Ref, "AI summons ♣8 as Soldier");
}
// AI pass on C8 summon
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes");
}
// Human pass on C8 summon
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes on C8 summon");
}

// AI Turn 3 エンド
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const endRef = step.request.patterns.findIndex(p => p.actionSelectionRef !== undefined && step.request.catalog.actions[p.actionSelectionRef]?.actionId === "action.end");
  recordAndSubmit("policy", "p2", endRef, "AI ends Turn 3");
}
// AI pass on end
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p2") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("policy", "p2", passRef, "AI passes");
}
// Human pass on end -> Turn 3 ends
if (step.type === "WAITING_FOR_DECISION" && step.request.playerId === "p1") {
  const passRef = step.request.patterns.findIndex(p => p.kind === "PASS");
  recordAndSubmit("human", "p1", passRef, "Human passes on Turn 3 end");
}

// -----------------------------------------------------------------------------
// TURN 4: Human (P1 後攻)
// 1. ドロー解決
// 2. 人間が ♠Q＋♦2 で死の槍を実行（対象: AI の ♣8 兵士）
// 3. AI 敗北！
// -----------------------------------------------------------------------------
console.log("\n--- TURN 3 END / TURN 4 TRANSITION ---");
// Turn 3 手札上限ディスカード等のループ
while (step.type === "WAITING_FOR_DECISION" && session.state.turnCount === 3) {
  const req = step.request;
  console.log(`[Turn 3 Extra Decision] Player: ${req.playerId}, Kind: ${req.patterns[0]?.kind}, Legal: ${req.patterns.length}`);
  if (req.playerId === "p2") {
    // AI の手番
    const evalRes = evaluateAI(req);
    console.log(`AI top choices:`, evalRes.sorted.slice(0, 3).map(s => ({
      ref: s.patternRef,
      pat: req.patterns[s.patternRef]?.patternId,
      score: s.score
    })));
    recordAndSubmit("policy", "p2", evalRes.best.patternRef, `AI decision (best score: ${evalRes.best.score})`);
  } else {
    // Human
    console.log("Human decision patterns:", req.patterns.map(p => p.patternId));
    const passRef = req.patterns.findIndex(p => p.kind === "PASS");
    recordAndSubmit("human", "p1", passRef >= 0 ? passRef : 0, "Human responds");
  }
}

console.log("\n--- TURN 4 START ---");
console.log(`Turn: ${session.state.turnCount}, TurnPlayer: ${session.state.turnPlayer}`);
console.log("P1 Hand:", session.state.players.p1.hand.map((c: any) => `${c.suit}${c.rank}`));
console.log("P2 Life count:", session.state.players.p2.life.length);

// Turn 4 のループ (Turn 4 が終わるかゲーム終了まで)
while (step.type === "WAITING_FOR_DECISION" && session.state.turnCount === 4 && step.type !== "FINISHED") {
  const req = step.request;
  console.log(`\n[Turn 4 Decision] Seq: ${decisionSeq + 1}, Player: ${req.playerId}, Legal: ${req.patterns.length}`);

  if (req.playerId === "p1") {
    // 人間の手番
    const passRef = req.patterns.findIndex(p => p.kind === "PASS");
    
    // 死の槍 (♠Q + ♦2) -> AIのユニット（p2）を対象にする！
    const dlRef = req.patterns.findIndex(p => {
      if (p.actionSelectionRef === undefined) return false;
      const act = req.catalog.actions[p.actionSelectionRef];
      return act?.actionId === "action.deathLance" && p.patternId.includes("SQ") && p.patternId.includes("D2") && p.patternId.includes("p2");
    });

    if (dlRef >= 0) {
      console.log(`Found Human 2nd deathLance with SQ+D2 on P2 (ref #${dlRef}): ${req.patterns[dlRef].patternId}`);
      recordAndSubmit("human", "p1", dlRef, "Human casts action.deathLance with ♠Q + ♦2 on AI unit");
    } else {
      // 死の槍のあとは、人間は攻撃 (action.attack) を仕掛ける！
      const attRef = req.patterns.findIndex(p => p.actionSelectionRef !== undefined && req.catalog.actions[p.actionSelectionRef]?.actionId === "action.attack");
      const heroUnitRef = req.patterns.findIndex(p => p.kind === "EFFECT_SELECTION" && p.patternId.includes("hero"));
      
      if (attRef >= 0) {
        recordAndSubmit("human", "p1", attRef, "Human attacks with Size 13 Hero");
      } else if (heroUnitRef >= 0) {
        recordAndSubmit("human", "p1", heroUnitRef, "Human selects Size 13 Hero to attack!");
      } else if (passRef >= 0) {
        recordAndSubmit("human", "p1", passRef, "Human passes");
      } else {
        console.log("Human choices:", req.patterns.map(p => p.patternId));
        recordAndSubmit("human", "p1", 0, "Human choice #0");
      }
    }
  } else {
    // AI (P2) の手番
    const evalRes = evaluateAI(req);
    console.log(`AI choices in Turn 4 (Best: #${evalRes.best.patternRef} ${req.patterns[evalRes.best.patternRef]?.patternId}, score: ${evalRes.best.score})`);
    recordAndSubmit("policy", "p2", evalRes.best.patternRef, `AI decision (Turn 4)`);
  }
}
// ゲーム終了または継続
console.log(`\nFinal Game State:`);
console.log(`- Turn: ${session.state.turnCount}`);
console.log(`- Step Type: ${step.type}`);
if (step.type === "FINISHED") {
  console.log(`- Result: Winner = ${step.result.winner}, Reason = ${step.result.reason}`);
}
console.log(`- Total Decisions Executed: ${decisionSeq}`);

// 診断バンドルを構築してローカル保存（※Gitにはコミットしない）
const outDir = path.resolve(process.cwd(), ".artifacts/diagnostic-reconstructed");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "reconstructed-playtest-diagnostic-seed4127992094.json");

const diagnosticBundle = buildPlaytestDiagnosticBundleV1({
  build: {
    sha: "974e9b00d38efc640a115f9e295f347f2054dbdb",
    ref: "refs/heads/BlackPoker/issue551-core-flow",
  },
  generatedAt: new Date().toISOString(),
  activeMatch: {
    environmentId: envId,
    environmentName: "スタンダード＋パック (公式)",
    regulationId: "standard-pack",
    seed: 4127992094,
    rulePackage: (outcome as any).activeMatch?.rulePackage ?? fullRulePackage,
  },
  activePlaytestSettings: {
    matchMode: "humanVsAi",
    humanSeat: "p1",
    policyId: "gen8-champion-candidate",
  },
  seatControllers: {
    p1: { kind: "HUMAN", playerId: "p1" },
    p2: { kind: "POLICY", playerId: "p2", policyId: "gen8-champion-candidate" },
  },
  currentStep: step,
  rawState: session.state,
  canonicalMatchLog: (session as any).logRecorder,
  decisionTranscript,
});

fs.writeFileSync(outPath, JSON.stringify(diagnosticBundle, null, 2), "utf-8");
console.log(`\nDiagnostic Bundle generated at: ${outPath}`);
console.log(`- Contains ${diagnosticBundle.decisionTranscript.length} decisions`);
