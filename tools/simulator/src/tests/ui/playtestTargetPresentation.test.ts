import { describe, it, expect } from "vitest";
import { PlaytestTargetPresenter } from "../../engine/decision/PlaytestTargetPresenter";
import { TargetSelectionEnumerator } from "../../engine/decision/TargetSelectionEnumerator";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";

describe("Playtest Target Presentation Tests", () => {
  describe("PlaytestTargetPresenter", () => {
    it("Requestターゲットの2段表示ラベルを正しく生成すること", () => {
      const stageRequest = {
        id: "req-101",
        actionId: "action.attack",
        controller: "p1",
        action: { name: "攻撃" },
      };

      const labels = PlaytestTargetPresenter.formatRequestTarget(stageRequest);
      expect(labels.primaryLabel).toBe("Player A: 攻撃");
      expect(labels.secondaryLabel).toBe("Stage TOP [req-101]");
    });

    it("Unitターゲットの2段表示ラベルを正しく生成すること (英雄・防壁)", () => {
      const heroUnit = {
        unitId: "u-hero",
        kind: "英雄",
        state: "charge",
        face: "up",
        cards: [{ suit: "S", rank: 1 }],
      };
      const bulwarkUnit = {
        unitId: "u-bulwark-1",
        kind: "防壁",
        state: "charge",
        face: "down",
        cards: [{ suit: "D", rank: 8 }],
      };

      // 英雄 (自分視点)
      const heroLabels = PlaytestTargetPresenter.formatUnitTarget(heroUnit, "p1", [heroUnit], "p1");
      expect(heroLabels.primaryLabel).toBe("Player A の 英雄");
      expect(heroLabels.secondaryLabel).toContain("♠1");

      // 相手の伏せ防壁 (非公開情報保護: カードコードを隠蔽)
      const bulwarkOpponentLabels = PlaytestTargetPresenter.formatUnitTarget(
        bulwarkUnit,
        "p2",
        [bulwarkUnit],
        "p1" // viewer is p1, unit owner is p2
      );
      expect(bulwarkOpponentLabels.primaryLabel).toBe("Player B の 防壁①");
      expect(bulwarkOpponentLabels.secondaryLabel).toContain("🂠");
      expect(bulwarkOpponentLabels.secondaryLabel).toContain("charge");
      expect(bulwarkOpponentLabels.secondaryLabel).not.toContain("D8");
      expect(bulwarkOpponentLabels.secondaryLabel).not.toContain("♢8");
    });

    it("Playerターゲットのラベルを生成すること", () => {
      const labels = PlaytestTargetPresenter.formatPlayerTarget("p2");
      expect(labels.primaryLabel).toBe("Player B");
      expect(labels.secondaryLabel).toBe("プレイヤー");
    });
  });

  describe("TargetSelectionEnumerator", () => {
    it("TargetSelection に primaryLabel と secondaryLabel が付与され、既存 displayName と後方互換性を持つこと", () => {
      const state = createCoreBattlePresetState();
      state.stage.requests = [
        {
          id: "req-target-1",
          actionId: "action.attack",
          controller: "p1",
          action: { name: "攻撃" },
        },
      ];

      const targets = [
        {
          id: "target_request",
          type: "request",
          selector: "request",
          targetType: "request",
          constraint: {
            scope: "stage",
          },
        },
      ];

      const results = TargetSelectionEnumerator.enumerateTargets(
        { id: "action.counter", name: "カウンター", targets } as any,
        state,
        "p2"
      );
      expect(results.length).toBeGreaterThan(0);

      const targetSel = results[0];
      expect(targetSel.displayName).toBeDefined();
      expect(targetSel.primaryLabel).toBe("Player A: 攻撃");
      expect(targetSel.secondaryLabel).toContain("req-target-1");
      expect(targetSel.targetRequestId).toBe("req-target-1");
    });

    it("requesterPlayerKey=p1時、TargetSelectionEnumerator で列挙される p2 の伏せ防壁の card suit/rank/code が primaryLabel / secondaryLabel / displayName のどこにも漏洩しないこと", () => {
      const state = createCoreBattlePresetState();
      // p2 の field に伏せ防壁 (♢8) を配置
      state.players.p2.field = [
        {
          unitId: "u-p2-bulwark",
          kind: "防壁",
          componentId: "character.bulwark",
          state: "charge",
          face: "down",
          cards: [{ suit: "D", rank: 8, code: "♢8" }],
        },
      ];

      const targets = [
        {
          id: "target_unit",
          type: "unit",
          selector: "unit",
          targetType: "unit",
          condition: {
            owner: "opponent",
          },
        },
      ];

      const results = TargetSelectionEnumerator.enumerateTargets(
        { id: "action.destroyBulwark", name: "防壁破壊", targets } as any,
        state,
        "p1" // requester is p1
      );

      expect(results.length).toBeGreaterThan(0);
      const bulwarkTarget = results.find((t) => t.targetUnitId === "u-p2-bulwark");
      expect(bulwarkTarget).toBeDefined();

      const allTexts = `${bulwarkTarget!.primaryLabel} ${bulwarkTarget!.secondaryLabel} ${bulwarkTarget!.displayName}`;
      // suit / rank / code が一切含まれないこと
      expect(allTexts).not.toContain("D8");
      expect(allTexts).not.toContain("♢8");
      expect(allTexts).not.toContain("♢");
      expect(allTexts).not.toContain("8");
      // 伏せ防壁であることを示す安全なラベルであること
      expect(bulwarkTarget!.primaryLabel).toBe("Player B の 防壁①");
      expect(bulwarkTarget!.secondaryLabel).toContain("🂠");
      expect(bulwarkTarget!.secondaryLabel).toContain("charge");
    });
  });
});
