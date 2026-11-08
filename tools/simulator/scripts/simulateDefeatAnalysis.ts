import { loadRulePackageForBrowser } from "../src/engine/rules/BrowserRuleLoader";
import { loadRegulationCatalogForBrowser } from "../src/engine/regulation/BrowserRegulationLoader";
import { startMatchAttempt, OFFICIAL_ENV_PREFIX } from "../src/engine/playtest/PlaytestEnvironmentController";
import { createGen8ChampionCandidatePolicy } from "../src/engine/ai/Gen8DNALoader";
import { DecisionFeatureEncoder } from "../src/engine/ai/DecisionFeatureEncoder";
import { GenomeScorer } from "../src/engine/ai/GenomeScorer";
import { DecisionRequest } from "../src/domain/decision/DecisionRequest";
import { GameSession, GameSessionStep } from "../src/engine/session/GameSession";

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

function logState(stepNum: number, desc: string) {
  console.log(`\n======================================================================`);
  console.log(`[STEP ${stepNum}] ${desc}`);
  console.log(`Turn: ${session.state.turnCount} | TurnPlayer: ${session.state.turnPlayer} | Chance: ${session.state.chancePlayer} | Focus: ${session.state.focusPlayer}`);
  const p1Units = (session.state.players.p1.field || []).map((u: any) => `${u.kind}(size:${u.cards.reduce((s:number,c:any)=>s+c.value,0)},cards:${u.cards.map((c:any)=>c.suit+c.rank).join("+")},state:${u.state})`).join(", ");
  const p2Units = (session.state.players.p2.field || []).map((u: any) => `${u.kind}(size:${u.cards.reduce((s:number,c:any)=>s+c.value,0)},cards:${u.cards.map((c:any)=>c.suit+c.rank).join("+")},state:${u.state})`).join(", ");
  console.log(`P1 (Human) Life: ${session.state.players.p1.life.length} | Hand: ${session.state.players.p1.hand.length} | Units: ${p1Units || 'none'}`);
  console.log(`P2 (AI)    Life: ${session.state.players.p2.life.length} | Hand: ${session.state.players.p2.hand.length} | Units: ${p2Units || 'none'}`);
  if (session.state.stage?.requests?.length > 0) {
    console.log(`Stage (${session.state.stage.requests.length}): ${session.state.stage.requests.map((r:any)=>r.actionId).join(" -> ")}`);
  }
}

function evaluateAI(req: DecisionRequest, tag: string) {
  const features = DecisionFeatureEncoder.encode(req);
  const scored = GenomeScorer.score(features, dna);
  const sorted = [...scored].sort((a, b) => b.score - a.score);

  console.log(`\n--- [AI Decision: ${tag}] (reqPlayer=${req.playerId}, patterns=${req.patterns.length}) ---`);
  console.log(`TOP 5 CHOICES:`);
  for (let i = 0; i < Math.min(5, sorted.length); i++) {
    const s = sorted[i];
    const p = req.patterns[s.patternRef];
    const act = p.actionSelectionRef !== undefined ? req.catalog.actions[p.actionSelectionRef] : undefined;
    console.log(`  #${i+1} Pattern #${s.patternRef}: score=${s.score.toFixed(4)} | kind=${p.kind} | action=${act?.actionId || 'N/A'} | id=${p.patternId}`);
  }

  const passIndex = req.patterns.findIndex((p) => p.kind === "PASS");
  if (passIndex >= 0) {
    const passObj = scored.find((s) => s.patternRef === passIndex);
    const passRank = sorted.findIndex((s) => s.patternRef === passIndex) + 1;
    console.log(`  [PASS] Rank ${passRank}/${req.patterns.length}: score=${passObj?.score.toFixed(4)}`);
  }

  const attackIndex = req.patterns.findIndex((p) => p.actionSelectionRef !== undefined && req.catalog.actions[p.actionSelectionRef]?.actionId === "action.attack");
  if (attackIndex >= 0) {
    const attObj = scored.find((s) => s.patternRef === attackIndex);
    const attRank = sorted.findIndex((s) => s.patternRef === attackIndex) + 1;
    console.log(`  [ATTACK] Rank ${attRank}/${req.patterns.length}: score=${attObj?.score.toFixed(4)}`);
  }

  return { sorted, best: sorted[0], scored, features };
}

let step: GameSessionStep = outcome.initialStep;
let stepCount = 0;

function submit(patternRef: number, desc: string) {
  if (step.type !== "WAITING_FOR_DECISION") throw new Error(`Not in WAITING_FOR_DECISION`);
  stepCount++;
  logState(stepCount, desc);
  const req = step.request;
  step = session.submitDecision({
    decisionId: req.decisionId,
    stateVersion: req.stateVersion,
    selectedPatternRef: patternRef,
  });
}

// -----------------------------------------------------------------------------
// Turn 1: AI (P2)
// -----------------------------------------------------------------------------
console.log("\n=================== START SIMULATION: Seed 4127992094 ===================");

// Turn 1 の AI 行動（攻撃 -> PASS -> ユニット選択 -> S10召喚 -> SA召喚 -> 投擲 -> エンド）
while (step.type === "WAITING_FOR_DECISION" && session.state.turnCount === 1) {
  const req = step.request;
  if (req.playerId === "p2") {
    const evalRes = evaluateAI(req, `Turn 1 AI Action`);
    submit(evalRes.best.patternRef, `AI submits ${req.patterns[evalRes.best.patternRef].patternId}`);
  } else {
    // P1 (Human) は基本スルー（PASSまたは0番選択）
    const passRef = req.patterns.findIndex(p => p.kind === "PASS");
    const choice = passRef >= 0 ? passRef : 0;
    submit(choice, `Human passes/confirms in Turn 1`);
  }
}

// -----------------------------------------------------------------------------
// Turn 2: Human (P1)
// -----------------------------------------------------------------------------
console.log("\n=================== TURN 2: HUMAN (P1) ===================");

let humanActionSequence = 0;

while (step.type === "WAITING_FOR_DECISION" && session.state.turnCount === 2) {
  const req = step.request;

  if (req.playerId === "p2") {
    // AI の思考
    const isDeathLanceOnStage = session.state.stage?.requests?.some((r: any) => r.actionId === "action.deathLance");
    if (isDeathLanceOnStage) {
      console.log(`\n**********************************************************************`);
      console.log(`*** [AUDIT POINT 1] AI RESPONSE TO DEATH LANCE ON STAGE ***`);
      console.log(`**********************************************************************`);
      const evalRes = evaluateAI(req, `AI vs Death Lance`);
      submit(evalRes.best.patternRef, `AI responds to Death Lance: ${req.patterns[evalRes.best.patternRef].patternId}`);
    } else {
      const evalRes = evaluateAI(req, `Turn 2 AI Response`);
      submit(evalRes.best.patternRef, `AI submits ${req.patterns[evalRes.best.patternRef].patternId}`);
    }
  } else {
    // P1 (Human)
    const stageRequests = session.state.stage?.requests || [];

    if (stageRequests.length > 0) {
      // ステージに何かあれば PASS して解決を進める
      const passRef = req.patterns.findIndex(p => p.kind === "PASS");
      const choice = passRef >= 0 ? passRef : 0;
      submit(choice, `Human passes on stage request`);
    } else {
      // 人間のメイン行動シーケンス
      if (humanActionSequence === 0) {
        // 1. 死の槍（♠Q + ♢A）を S10 兵士に向けて発動！
        const dlRef = req.patterns.findIndex(p => {
          if (p.actionSelectionRef === undefined) return false;
          const act = req.catalog.actions[p.actionSelectionRef];
          return act?.actionId === "action.deathLance" && p.patternId.includes("SQ") && p.patternId.includes("DA");
        });
        if (dlRef >= 0) {
          humanActionSequence++;
          submit(dlRef, `Human plays action.deathLance (12 DAMAGE) with ♠Q+♢A targeting AI S10 Soldier!`);
        } else {
          console.log("Could not find deathLance with SQ and DA. Available actions:");
          req.patterns.forEach((p, idx) => {
            const act = p.actionSelectionRef !== undefined ? req.catalog.actions[p.actionSelectionRef] : undefined;
            if (act?.actionId === "action.deathLance") console.log(`  Pattern #${idx}: ${p.patternId}`);
          });
          humanActionSequence++;
          submit(0, `Fallback human action`);
        }
      } else if (humanActionSequence === 1) {
        // 2. mountSoldier で ♠K を武装してサイズ14/13の兵士を作成！
        const mountRef = req.patterns.findIndex(p => {
          if (p.actionSelectionRef === undefined) return false;
          const act = req.catalog.actions[p.actionSelectionRef];
          return act?.actionId === "action.mountSoldier" && p.patternId.includes("SK");
        });
        if (mountRef >= 0) {
          humanActionSequence++;
          submit(mountRef, `Human mounts ♠K onto soldier-p1-preset (Creates Size 14 Soldier)!`);
        } else {
          console.log("Could not find mountSoldier with SK. Patterns:");
          req.patterns.forEach((p, idx) => {
            const act = p.actionSelectionRef !== undefined ? req.catalog.actions[p.actionSelectionRef] : undefined;
            if (act?.actionId === "action.mountSoldier") console.log(`  Pattern #${idx}: ${p.patternId}`);
          });
          humanActionSequence++;
          submit(0, `Fallback human mount`);
        }
      } else {
        // 3. ターン終了
        const endRef = req.patterns.findIndex(p => {
          if (p.actionSelectionRef === undefined) return false;
          return req.catalog.actions[p.actionSelectionRef]?.actionId === "action.end";
        });
        const passRef = req.patterns.findIndex(p => p.kind === "PASS");
        const choice = endRef >= 0 ? endRef : (passRef >= 0 ? passRef : 0);
        submit(choice, `Human ends Turn 2`);
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Turn 3: AI (P2) 手番！
// -----------------------------------------------------------------------------
console.log("\n=================== TURN 3: AI (P2) ===================");
console.log("Target State Reached. Checking Field & AI Decisions in Turn 3...");

let turn3Decisions = 0;
while (step.type === "WAITING_FOR_DECISION" && session.state.turnCount === 3 && turn3Decisions < 10) {
  turn3Decisions++;
  const req = step.request;
  if (req.playerId === "p2") {
    console.log(`\n**********************************************************************`);
    console.log(`*** [AUDIT POINT 2] AI DECISION IN TURN 3 (#${turn3Decisions}) ***`);
    console.log(`**********************************************************************`);
    const evalRes = evaluateAI(req, `Turn 3 Decision #${turn3Decisions}`);
    
    // 詳細出力
    console.log(`Top 10 Patterns in Turn 3:`);
    for (let i = 0; i < Math.min(10, evalRes.sorted.length); i++) {
      const s = evalRes.sorted[i];
      const p = req.patterns[s.patternRef];
      const act = p.actionSelectionRef !== undefined ? req.catalog.actions[p.actionSelectionRef] : undefined;
      console.log(`  Rank ${i+1}: Pattern #${s.patternRef} (score: ${s.score.toFixed(4)}) -> kind: ${p.kind}, action: ${act?.actionId || 'N/A'}, id: ${p.patternId}`);
    }

    submit(evalRes.best.patternRef, `AI submits Turn 3 action: ${req.patterns[evalRes.best.patternRef].patternId}`);
  } else {
    // P1 (Human)
    // AI が攻撃してきた場合、サイズ13兵士でブロックする！
    const stageHasAttack = session.state.stage?.requests?.some((r: any) => r.actionId === "action.attack");
    if (stageHasAttack) {
      console.log(`\nHuman sees AI attack on stage!`);
    }

    const blockRef = req.patterns.findIndex(p => {
      if (p.actionSelectionRef === undefined) return false;
      return req.catalog.actions[p.actionSelectionRef]?.actionId === "action.block";
    });

    const passRef = req.patterns.findIndex(p => p.kind === "PASS");
    const choice = blockRef >= 0 ? blockRef : (passRef >= 0 ? passRef : 0);
    submit(choice, `Human responds in Turn 3 (Block or Pass)`);
  }
}

console.log(`\nSimulation complete! Current Turn: ${session.state.turnCount}, Step Type: ${step.type}`);
