import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadRulePackageForBrowser } from "../../engine/rules/BrowserRuleLoader.js";
import { RulePackage } from "../../domain/rules/RulePackage.js";
import { PlaytestPolicyFactory } from "../../engine/playtest/PlaytestPolicyFactory.js";
import { Gen9TacticalPrototypePolicy } from "../../engine/ai/Gen9TacticalPrototypePolicy.js";
import { Gen9LearnableTacticalPolicy } from "../../engine/ai/Gen9LearnableTacticalPolicy.js";

describe("Work 5-7A R1: 独立レビュー向け検証", () => {
  let rulePackage: RulePackage;
  let policyV72: Gen9TacticalPrototypePolicy;
  let policyV73: Gen9LearnableTacticalPolicy;

  beforeAll(() => {
    rulePackage = loadRulePackageForBrowser();

    policyV72 = PlaytestPolicyFactory.createPolicy(
      "gen9-r4-v72",
      undefined,
      "p2",
      "standard-pack",
      rulePackage
    ) as Gen9TacticalPrototypePolicy;

    policyV73 = PlaytestPolicyFactory.createPolicy(
      "gen9-cost-preview-v73",
      undefined,
      "p2",
      "standard-pack",
      rulePackage
    ) as Gen9LearnableTacticalPolicy;
  });

  let outData: any = {};

  afterAll(() => {
    const outPath = path.resolve(__dirname, "../../../evidence/audit_verification_r1_out.json");
    fs.writeFileSync(outPath, JSON.stringify(outData, null, 2), "utf-8");
  });

  it("BP-AI-14 の詳細スコア内訳 (currentSize なし vs あり)", () => {
    // 1. 現状の Fixture (size のみ, currentSize なし)
    const reqWithoutCurrentSize: any = {
      protocolVersion: "1.0.0",
      matchId: "audit-match-14",
      decisionId: "dec-bp-ai-14",
      stateVersion: 10,
      playerId: "p2",
      source: { type: "ACTION_REQUEST", playerId: "p2" },
      catalog: {
        actions: [{ actionId: "action.attack", actionName: "アタック" }, { actionId: "action.end", actionName: "エンド" }],
        unitSelections: [{ unitIds: ["u-small-charge"] }],
        targetSelections: [],
        costPayments: [],
        effectSelections: [],
        cardSelections: [],
        orderSelections: [],
      },
      observation: {
        viewerPlayerId: "p2",
        turnPlayerId: "p2",
        chancePlayerId: "p2",
        players: [
          {
            playerId: "p1",
            handCount: 3,
            lifeCount: 15,
            field: [{ unitId: "u-p1-wall", size: 6, state: "charge", labels: ["soldier"] }],
          },
          {
            playerId: "p2",
            handCount: 2,
            lifeCount: 10,
            field: [{ unitId: "u-small-charge", size: 1, state: "charge", labels: ["soldier"] }],
          },
        ],
      },
      patterns: [
        { patternRef: 0, patternId: "pat-suicide-attack", kind: "ACTION", actionSelectionRef: 0, unitSelectionRef: 0 },
        { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
      ],
    };

    const evalWithout = policyV72.evaluatePatterns(reqWithoutCurrentSize);

    // 2. 正確な UnitView (currentSize あり)
    const reqWithCurrentSize: any = {
      ...reqWithoutCurrentSize,
      observation: {
        ...reqWithoutCurrentSize.observation,
        players: [
          {
            playerId: "p1",
            handCount: 3,
            lifeCount: 15,
            field: [{ unitId: "u-p1-wall", currentSize: 6, size: 6, state: "charge", labels: ["soldier"] }],
          },
          {
            playerId: "p2",
            handCount: 2,
            lifeCount: 10,
            field: [{ unitId: "u-small-charge", currentSize: 1, size: 1, state: "charge", labels: ["soldier"] }],
          },
        ],
      },
    };

    const evalWith = policyV72.evaluatePatterns(reqWithCurrentSize);

    outData.bp_ai_14_without = evalWithout;
    outData.bp_ai_14_with = evalWith;
  });

  it("v7.2 と v7.3 のスコア・特徴量詳細比較", () => {
    // BP-AI-09 (死の槍)
    const reqDL: any = {
      protocolVersion: "1.0.0",
      matchId: "audit-match-09",
      decisionId: "dec-bp-ai-09",
      stateVersion: 12,
      playerId: "p2",
      source: { type: "ACTION_REQUEST", playerId: "p2" },
      catalog: {
        actions: [{ actionId: "action.deathLance", actionName: "死の槍" }, { actionId: "action.end", actionName: "エンド" }],
        cardSelections: [{ cardIds: ["card-da"], displayCodes: ["DA"] }],
        unitSelections: [],
        targetSelections: [{ targetType: "unit", targetUnitId: "u-p1-boss" }],
        costPayments: [{ discardedCardIds: ["card-sk"], drivenBulwarkUnitIds: [], sacrificedUnitIds: [], lifeCount: 0 }],
        effectSelections: [],
        orderSelections: [],
      },
      observation: {
        viewerPlayerId: "p2",
        turnPlayerId: "p2",
        chancePlayerId: "p2",
        players: [
          {
            playerId: "p1",
            handCount: 2,
            lifeCount: 10,
            field: [{ unitId: "u-p1-boss", currentSize: 10, size: 10, state: "charge", labels: ["soldier"] }],
          },
          {
            playerId: "p2",
            handCount: 3,
            lifeCount: 10,
            field: [],
            hand: [
              { id: "card-da", suit: "D", rank: "A", value: 1 },
              { id: "card-sk", suit: "S", rank: "K", value: 10 },
            ],
          },
        ],
      },
      patterns: [
        { patternRef: 0, patternId: "pat-dl", kind: "ACTION", actionSelectionRef: 0, cardSelectionRef: 0, targetSelectionRef: 0, costPaymentRef: 0 },
        { patternRef: 1, patternId: "pat-end", kind: "ACTION", actionSelectionRef: 1 },
      ],
    };

    const eval72 = policyV72.evaluatePatterns(reqDL);
    const eval73 = policyV73.evaluatePatterns(reqDL);

    console.log("=== policyV73 weights ===", (policyV73 as any).genome?.tacticalWeights);

    // 正式な KnownCardView 形式の Fixture (cardInstanceId & visibility: "KNOWN")
    const reqDLWithValidCards: any = {
      ...reqDL,
      observation: {
        ...reqDL.observation,
        players: [
          reqDL.observation.players[0],
          {
            ...reqDL.observation.players[1],
            handCards: [
              { cardInstanceId: "card-da", visibility: "KNOWN", suit: "D", rank: "A", value: 1, faceUp: true },
              { cardInstanceId: "card-sk", visibility: "KNOWN", suit: "S", rank: "K", value: 10, faceUp: true },
            ],
          },
        ],
      },
    };

    const evalValid72 = policyV72.evaluatePatterns(reqDLWithValidCards);
    const evalValid73 = policyV73.evaluatePatterns(reqDLWithValidCards);

    outData.policyV73_weights = (policyV73 as any).genome?.tacticalWeights;
    outData.bp_ai_09_v72 = eval72;
    outData.bp_ai_09_v73 = eval73;
    outData.valid_cards_v72 = evalValid72;
    outData.valid_cards_v73 = evalValid73;
  });
});
