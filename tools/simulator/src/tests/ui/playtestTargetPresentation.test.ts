import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { PlaytestTargetPresenter } from "../../engine/decision/PlaytestTargetPresenter";
import { TargetSelectionEnumerator } from "../../engine/decision/TargetSelectionEnumerator";
import { createCoreBattlePresetState } from "../../engine/session/playtest/createCoreBattlePlaytest";
import { StagePanel } from "../../ui/game/StagePanel";
import { GameStatusBar } from "../../ui/game/GameStatusBar";
import { DecisionPanel } from "../../ui/decision/DecisionPanel";

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

    it("A: viewer=p1, owner=p1 の伏せ防壁 (♢8) は primaryLabel: 'Player A の 防壁①', secondaryLabel/displayName で ♢8 が確認でき 🂠 ではないこと", () => {
      const bulwarkUnit = {
        unitId: "u-bulwark-p1",
        kind: "防壁",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [{ suit: "D", rank: 8 }],
      };

      const labels = PlaytestTargetPresenter.formatUnitTarget(
        bulwarkUnit,
        "p1",
        [bulwarkUnit],
        "p1" // viewer is p1, owner is p1
      );

      expect(labels.primaryLabel).toBe("Player A の 防壁①");
      expect(labels.secondaryLabel).toContain("♢8");
      expect(labels.secondaryLabel).toContain("charge");
      expect(labels.secondaryLabel).not.toContain("🂠");
      expect(labels.displayName).toBe("Player A の 防壁① [♢8] (charge)");
      expect(labels.displayName).not.toContain("🂠");
    });

    it("B: viewer=p1, owner=p2 の伏せ防壁 (♢8) は ♢8 / D8 / rank 8 が漏洩せず 🂠 が表示されること", () => {
      const bulwarkUnit = {
        unitId: "u-bulwark-p2",
        kind: "防壁",
        componentId: "character.bulwark",
        state: "charge",
        face: "down",
        cards: [{ suit: "D", rank: 8, code: "♢8" }],
      };

      const labels = PlaytestTargetPresenter.formatUnitTarget(
        bulwarkUnit,
        "p2",
        [bulwarkUnit],
        "p1" // viewer is p1, owner is p2
      );

      expect(labels.primaryLabel).toBe("Player B の 防壁①");
      expect(labels.secondaryLabel).toContain("🂠");
      expect(labels.secondaryLabel).toContain("charge");
      expect(labels.secondaryLabel).not.toContain("♢8");
      expect(labels.secondaryLabel).not.toContain("D8");
      expect(labels.secondaryLabel).not.toContain("8");
      expect(labels.displayName).toBe("Player B の 防壁① [🂠] (charge)");
      expect(labels.displayName).not.toContain("♢8");
      expect(labels.displayName).not.toContain("D8");
      expect(labels.displayName).not.toContain("8");
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

    it("C: TargetSelectionEnumerator経由でも requesterPlayerKey=p1 に対し、A (自分p1の伏せ防壁: ♢8表示・🂠なし) と B (相手p2の伏せ防壁: 🂠表示・情報漏洩なし) が同じ契約になること", () => {
      const state = createCoreBattlePresetState();
      state.players.p1.field = [
        {
          unitId: "u-p1-bulwark",
          kind: "防壁",
          componentId: "character.bulwark",
          state: "charge",
          face: "down",
          cards: [{ suit: "D", rank: 8, code: "♢8" }],
        },
      ];
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
        },
      ];

      const results = TargetSelectionEnumerator.enumerateTargets(
        { id: "action.destroyBulwark", name: "防壁破壊", targets } as any,
        state,
        "p1" // requester is p1
      );

      // A 検証: 自分の伏せ防壁 (♢8確認可能、🂠ではない)
      const ownTarget = results.find((t) => t.targetUnitId === "u-p1-bulwark");
      expect(ownTarget).toBeDefined();
      expect(ownTarget!.primaryLabel).toBe("Player A の 防壁①");
      expect(ownTarget!.secondaryLabel).toContain("♢8");
      expect(ownTarget!.secondaryLabel).not.toContain("🂠");
      expect(ownTarget!.displayName).toBe("Player A の 防壁① [♢8] (charge)");
      expect(ownTarget!.displayName).not.toContain("🂠");

      // B 検証: 相手の伏せ防壁 (♢8 / D8 / rank 8 が漏洩せず、🂠が表示される)
      const oppTarget = results.find((t) => t.targetUnitId === "u-p2-bulwark");
      expect(oppTarget).toBeDefined();
      expect(oppTarget!.primaryLabel).toBe("Player B の 防壁①");
      expect(oppTarget!.secondaryLabel).toContain("🂠");
      expect(oppTarget!.secondaryLabel).toContain("charge");
      expect(oppTarget!.secondaryLabel).not.toContain("♢8");
      expect(oppTarget!.secondaryLabel).not.toContain("D8");
      expect(oppTarget!.secondaryLabel).not.toContain("8");
      expect(oppTarget!.displayName).toBe("Player B の 防壁① [🂠] (charge)");
      expect(oppTarget!.displayName).not.toContain("♢8");
      expect(oppTarget!.displayName).not.toContain("D8");
      expect(oppTarget!.displayName).not.toContain("8");
    });
  });

  describe("Request Target Key Presentation Tests (UI Phase 2.9)", () => {
    it("Test A: Request対象にキーカード情報（単一キー）が正しく表示されること", () => {
      const counterRequest = {
        id: "req-2",
        actionId: "action.counter",
        controller: "p2",
        action: { name: "カウンター" },
        keyCards: [{ suit: "C", rank: "6" }],
      };

      const labels = PlaytestTargetPresenter.formatRequestTarget(counterRequest, true);
      expect(labels.primaryLabel).toBe("Player B: カウンター");
      expect(labels.secondaryLabel).toBe("Key: ♣6 ・ Stage TOP [req-2]");
      expect(labels.displayName).toBe("Player B: カウンター (Key: ♣6 ・ Stage TOP [req-2])");
    });

    it("Test B: 複数キーカードのRequest対象に全キーカードが表示されること", () => {
      const multiKeyRequest = {
        id: "req-x",
        actionId: "action.combo",
        controller: "p1",
        action: { name: "コンボ" },
        keyCards: [
          { suit: "S", rank: "A" },
          { suit: "C", rank: "K" },
        ],
      };

      const labels = PlaytestTargetPresenter.formatRequestTarget(multiKeyRequest, false);
      expect(labels.primaryLabel).toBe("Player A: コンボ");
      expect(labels.secondaryLabel).toBe("Key: ♠A + ♣K ・ Stage [req-x]");
      expect(labels.displayName).toBe("Player A: コンボ (Key: ♠A + ♣K ・ Stage [req-x])");
    });

    it("Test C: キーカードが存在しないRequestに対象表示で 'Key:' の不自然な空表示が出ないこと", () => {
      const mountRequest = {
        id: "req-1",
        actionId: "action.mountSoldier",
        controller: "p1",
        action: { name: "装備" },
        keyCards: [],
      };

      const labels = PlaytestTargetPresenter.formatRequestTarget(mountRequest, false);
      expect(labels.primaryLabel).toBe("Player A: 装備");
      expect(labels.secondaryLabel).toBe("Stage [req-1]");
      expect(labels.secondaryLabel).not.toContain("Key:");
      expect(labels.secondaryLabel).not.toContain("undefined");
      expect(labels.displayName).toBe("Player A: 装備 (Stage [req-1])");
    });

    it("Test D: TargetSelectionEnumerator 経由でもキーカード情報が反映され、秘密情報境界が保護されること", () => {
      const state = createCoreBattlePresetState();
      state.stage.requests = [
        {
          id: "req-1",
          controller: "p1",
          actionId: "action.mountSoldier",
          action: { name: "装備" },
          keyCards: [],
          status: "pending",
        },
        {
          id: "req-2",
          controller: "p2",
          actionId: "action.counter",
          action: { name: "カウンター" },
          keyCards: [{ suit: "C", rank: "6" }],
          status: "pending",
        },
      ];

      const targets = [
        {
          id: "target_req",
          type: "request",
          targetType: "request",
        },
      ];

      const results = TargetSelectionEnumerator.enumerateTargets(
        { id: "action.counter", name: "カウンター", targets } as any,
        state,
        "p1"
      );

      const targetReq2 = results.find((t) => t.targetRequestId === "req-2");
      expect(targetReq2).toBeDefined();
      expect(targetReq2!.primaryLabel).toBe("Player B: カウンター");
      expect(targetReq2!.secondaryLabel).toBe("Key: ♣6 ・ Stage TOP [req-2]");

      const targetReq1 = results.find((t) => t.targetRequestId === "req-1");
      expect(targetReq1).toBeDefined();
      expect(targetReq1!.primaryLabel).toBe("Player A: 装備");
      expect(targetReq1!.secondaryLabel).toBe("Stage [req-1]");
      expect(targetReq1!.secondaryLabel).not.toContain("Key:");

      // 相手手札や非公開カードの文字列が混入していないこと
      expect(targetReq2!.displayName).not.toContain("Life");
      expect(targetReq2!.displayName).not.toContain("Hand");
    });
  });

  describe("Monochrome Target Highlighting & Seed Clarity Tests (UI Phase 2.9)", () => {
    it("Test E: DecisionPanel のターゲット選択ボタンが白黒基調のデザインであること", () => {
      const mockRequest = {
        decisionId: "dec-1",
        controller: "p1",
        turnPlayer: "p1",
        step: "action",
        source: { type: "ACTION_SELECTION" },
        patterns: [
          {
            actionSelectionRef: 0,
            costPaymentRef: 0,
            targetSelectionRef: 0,
          },
        ],
        catalog: {
          actions: [{ actionId: "action.counter", name: "カウンター", category: "attack" }],
          keySelections: [{ type: "none" }],
          costPayments: [{ type: "none" }],
          targetSelections: [
            {
              type: "request",
              targetRequestId: "req-2",
              displayName: "Player B: 攻撃 (Stage TOP [req-2])",
              primaryLabel: "Player B: 攻撃",
              secondaryLabel: "Stage TOP [req-2]",
            },
          ],
          effectPatterns: [{ description: "効果" }],
          effectSelections: [],
        },
      };

      // 1. 未選択状態のターゲットボタン検証
      const unselectedHtml = renderToString(
        React.createElement(DecisionPanel, {
          request: mockRequest as any,
          onSubmit: () => {},
          initialActionRef: 0,
          initialCostRef: 0,
        })
      );

      // 白黒基調のボタンクラス（未選択状態では border-zinc-300 bg-white）
      expect(unselectedHtml).toContain("border-zinc-300");
      expect(unselectedHtml).toContain("bg-white");
      expect(unselectedHtml).toContain("Player B: 攻撃");
      expect(unselectedHtml).toContain("Stage TOP [req-2]");
      // amber, orange, yellow 系が含まれないこと
      expect(unselectedHtml).not.toContain("amber");
      expect(unselectedHtml).not.toContain("orange");
      expect(unselectedHtml).not.toContain("yellow");

      // 2. 選択中状態のターゲットボタン検証
      const selectedHtml = renderToString(
        React.createElement(DecisionPanel, {
          request: mockRequest as any,
          onSubmit: () => {},
          initialActionRef: 0,
          initialCostRef: 0,
          initialTargetRef: 0,
        })
      );

      // 選択中白黒コントラスト（border-2 border-zinc-950 ring-1 ring-zinc-950 bg-zinc-100 text-zinc-950）
      expect(selectedHtml).toContain("border-2 border-zinc-950 ring-1 ring-zinc-950 bg-zinc-100 text-zinc-950");
      expect(selectedHtml).toContain("SELECTED");
      expect(selectedHtml).not.toContain("amber");
      expect(selectedHtml).not.toContain("orange");
      expect(selectedHtml).not.toContain("yellow");
    });

    it("Test F: StagePanel でハイライトされたRequestが白黒基調スタイルおよびTARGETEDバッジで描画されること", () => {
      const requests = [
        {
          id: "req-top",
          controller: "p2",
          actionId: "action.counter",
          action: { name: "カウンター" },
          status: "pending",
        },
      ];

      const html = renderToString(
        React.createElement(StagePanel, {
          requests,
          highlightedRequestId: "req-top",
        })
      );

      // TARGETED バッジ
      expect(html).toContain("TARGETED");
      expect(html).toContain("bg-zinc-950 text-white font-mono text-[9px] font-black");
      // 白黒枠・背景
      expect(html).toContain("bg-zinc-100 border-2 border-zinc-950 shadow-md ring-2 ring-zinc-950 text-zinc-950");
      // amber, orange, yellow 系が含まれないこと
      expect(html).not.toContain("amber");
      expect(html).not.toContain("orange");
      expect(html).not.toContain("yellow");
    });

    it("Test G: StagePanel でハイライトされた非TOPのRequestがMobileでも折りたたまれず表示されること", () => {
      const requests = [
        {
          id: "req-bottom",
          controller: "p1",
          actionId: "action.mountSoldier",
          action: { name: "装備" },
          status: "pending",
        },
        {
          id: "req-top",
          controller: "p2",
          actionId: "action.counter",
          action: { name: "カウンター" },
          status: "pending",
        },
      ];

      // ハイライトなしの場合、非TOPの req-bottom は hidden lg:flex になる
      const unhighlightedHtml = renderToString(
        React.createElement(StagePanel, {
          requests,
          highlightedRequestId: null,
        })
      );
      expect(unhighlightedHtml).toContain("hidden lg:flex");

      // req-bottom がハイライトされた場合、Mobile でも flex となり非表示クラスにならないこと
      const highlightedHtml = renderToString(
        React.createElement(StagePanel, {
          requests,
          highlightedRequestId: "req-bottom",
        })
      );
      // req-bottom のコンテナに TARGETED バッジが付与され、Mobile で表示される
      expect(highlightedHtml).toContain("TARGETED");
      // 非TOPであっても isHiddenOnMobile が false となり hidden lg:flex にならない
      expect(highlightedHtml).not.toContain("hidden lg:flex");
    });

    it("Test H: GameStatusBar に「対戦SEED:」と説明用ツールチップが表示されること", () => {
      const html = renderToString(
        React.createElement(GameStatusBar, {
          turnPlayer: "p1",
          chancePlayer: "p1",
          turnCount: 3,
          players: {
            p1: { name: "Player A" },
            p2: { name: "Player B" },
          },
          matchSeed: 42,
        })
      );

      expect(html).toContain("対戦SEED:");
      expect(html).toContain("42");
      expect(html).toContain("初期山札シャッフルおよび初期配置を決定論的に再現するシードです（AI DNAとは異なります）。");
      expect(html).toContain("cursor-help");
    });
  });
});

