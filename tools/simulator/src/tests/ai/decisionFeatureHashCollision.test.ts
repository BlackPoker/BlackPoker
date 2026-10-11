import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { StableIdentityEncoder } from "../../engine/ai/StableIdentityEncoder";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage } from "../../domain/rules/RulePackage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("StableIdentityEncoder & Hash Collision Diagnostics (Feature Schema v3)", () => {
  let rulePackage: RulePackage;

  beforeAll(async () => {
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    rulePackage = await loadRulePackageFromDirectory(rulesDir);
  });

  it("produces deterministic and stable vectors across multiple invocations", () => {
    const v1 = StableIdentityEncoder.encodeActionIdentity("action.attack");
    const v2 = StableIdentityEncoder.encodeActionIdentity("action.attack");
    expect(v1).toEqual(v2);
    expect(v1).toHaveLength(StableIdentityEncoder.BUCKET_COUNT);

    const activeBuckets = v1.filter((b) => b === 1).length;
    expect(activeBuckets).toBeGreaterThanOrEqual(1);
    expect(activeBuckets).toBeLessThanOrEqual(3);
  });

  it("produces all-zero vector for empty or undefined identifiers", () => {
    const vUndefined = StableIdentityEncoder.encodeActionIdentity(undefined);
    expect(vUndefined.every((b) => b === 0)).toBe(true);

    const vNull = StableIdentityEncoder.encodeActionIdentity(null);
    expect(vNull.every((b) => b === 0)).toBe(true);

    const vEmpty = StableIdentityEncoder.encodeActionIdentity("");
    expect(vEmpty.every((b) => b === 0)).toBe(true);
  });

  it("diagnoses Action ID collision rate across all implemented actions in RulePackage", () => {
    const actionIds = rulePackage.actions.map((a) => a.id);
    expect(actionIds.length).toBeGreaterThan(10);

    const signatureMap = new Map<string, string[]>();
    for (const actionId of actionIds) {
      const vec = StableIdentityEncoder.encodeActionIdentity(actionId);
      const signature = vec.join("");
      if (!signatureMap.has(signature)) {
        signatureMap.set(signature, []);
      }
      signatureMap.get(signature)!.push(actionId);
    }

    // 重大な完全衝突（同一シグネチャに複数のActionが落ちること）を監査
    const collisions: Array<{ signature: string; actions: string[] }> = [];
    for (const [signature, actions] of signatureMap.entries()) {
      if (actions.length > 1) {
        collisions.push({ signature, actions });
      }
    }

    console.log(`Action ID Count: ${actionIds.length}, Unique Signatures: ${signatureMap.size}`);
    if (collisions.length > 0) {
      console.warn("Detected Action ID collisions:", JSON.stringify(collisions, null, 2));
    }

    // 必須監査対象のペアが完全衝突していないことを厳格確認
    const downVec = StableIdentityEncoder.encodeActionIdentity("action.down");
    const upVec = StableIdentityEncoder.encodeActionIdentity("action.up");
    expect(downVec).not.toEqual(upVec);

    const searchVec = StableIdentityEncoder.encodeActionIdentity("action.search");
    const reverseVec = StableIdentityEncoder.encodeActionIdentity("action.reverse");
    expect(searchVec).not.toEqual(reverseVec);

    const attackVec = StableIdentityEncoder.encodeActionIdentity("action.attack");
    const blockVec = StableIdentityEncoder.encodeActionIdentity("action.block");
    expect(attackVec).not.toEqual(blockVec);

    // 全体の衝突率が非常に低い（衝突件数 0 または 許容範囲内）ことを確認
    expect(collisions.length).toBe(0);
  });

  it("diagnoses Effect Step ID collision across comprehensive real-code step IDs", () => {
    // 実コード (EffectInterpreter, GameSession, LegalPatternGenerator, rules-vnext) から棚卸しした全実態ステップID
    const effectStepIds = Array.from(
      new Set([
        // 1. EffectInterpreter commands
        "selectUnits",
        "selectBlockAssignments",
        "selectUnitAssignments",
        "selectCards",
        "selectCard",
        "selectDiscardCards",
        "discardDownTo",
        "selectOption",
        "selectUnitCardOrder",
        "selectActionTarget",
        "zoneTopSelection",
        // 2. GameSession / Trigger system
        "_triggerImmediateFinalization",
        // 3. Real Engine Actions & LegalPatternGenerator steps
        "selectAttacker",
        "selectBlocker",
        "selectTargetUnit",
        "selectSearchCard",
        "chooseTransformState",
        "selectCustomUnits",
        "selectLifeCard",
        // 4. Extended / Regulation steps
        "payCost",
        "reunionSelect",
        "revolutionSelect",
        "bulwarkCard",
        "chooseOption",
      ])
    );

    const signatureMap = new Map<string, string[]>();
    for (const stepId of effectStepIds) {
      const vec = StableIdentityEncoder.encodeEffectStepIdentity(stepId);
      const sig = vec.join("");
      if (!signatureMap.has(sig)) {
        signatureMap.set(sig, []);
      }
      signatureMap.get(sig)!.push(stepId);
    }

    const collisions = Array.from(signatureMap.entries()).filter(([_, steps]) => steps.length > 1);
    console.log(
      `Effect Step ID Count: ${effectStepIds.length}, Unique Signatures: ${signatureMap.size}, Collisions: ${collisions.length}`
    );
    if (collisions.length > 0) {
      console.warn("Detected Effect Step ID collisions:", JSON.stringify(collisions, null, 2));
    }
    expect(collisions.length).toBe(0);
  });
});
