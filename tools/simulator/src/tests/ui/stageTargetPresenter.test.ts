import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import {
  StageTargetPresenter,
  getStageRequestDisplayIndex,
} from "../../ui/game/StageTargetPresenter";
import type { UnitBattleDisplayInfo } from "../../ui/game/BattleRelationPresenter";
import { StagePanel } from "../../ui/game/StagePanel";

describe("StageTargetPresenter (UI Phase 3.1)", () => {
  describe("getStageRequestDisplayIndex", () => {
    it("LIFO配列の末尾をTOP、先頭をSTAGE #1と正しく計算すること", () => {
      const top = getStageRequestDisplayIndex(2, 3);
      expect(top.isTop).toBe(true);
      expect(top.label).toBe("TOP");

      const mid = getStageRequestDisplayIndex(1, 3);
      expect(mid.isTop).toBe(false);
      expect(mid.label).toBe("STAGE #2");

      const first = getStageRequestDisplayIndex(0, 3);
      expect(first.isTop).toBe(false);
      expect(first.label).toBe("STAGE #1");
    });
  });

  describe("StageTargetPresenter.buildStageTargetPresentation", () => {
    it("Test A: 同種一般兵2体存在時のターゲット個別識別 (盤面番号・カード・役職が付与されること)", () => {
      const battleMap = new Map<string, UnitBattleDisplayInfo>([
        [
          "u-soldier-1",
          {
            unitId: "u-soldier-1",
            badge: "①",
            label: "① ♠5 一般兵",
            blockedByBadges: [],
          },
        ],
        [
          "u-soldier-2",
          {
            unitId: "u-soldier-2",
            badge: "②",
            label: "② ♣6 一般兵",
            blockedByBadges: [],
          },
        ],
      ]);

      const requests = [
        {
          id: "req-1",
          actionId: "action.down",
          targets: [{ type: "unit", unitId: "u-soldier-2" }],
        },
      ];

      const presentation = StageTargetPresenter.buildStageTargetPresentation(requests, battleMap);
      const labels = presentation.requestTargetLabels.get("req-1");

      expect(labels).toBeDefined();
      expect(labels).toHaveLength(1);
      expect(labels?.[0]).toBe("② ♣6 一般兵");
    });

    it("Test B: 相手裏向き防壁ターゲット時の秘密保持 (カードコード非漏洩)", () => {
      const battleMap = new Map<string, UnitBattleDisplayInfo>([
        [
          "u-bulwark-opp",
          {
            unitId: "u-bulwark-opp",
            badge: "④",
            label: "④ 防壁",
            blockedByBadges: [],
          },
        ],
      ]);

      const requests = [
        {
          id: "req-destroy-bulwark",
          actionId: "action.destroyBulwark",
          targets: [{ type: "unit", unitId: "u-bulwark-opp" }],
        },
      ];

      const presentation = StageTargetPresenter.buildStageTargetPresentation(requests, battleMap);
      const labels = presentation.requestTargetLabels.get("req-destroy-bulwark");

      expect(labels).toBeDefined();
      expect(labels?.[0]).toBe("④ 防壁");
      expect(labels?.[0]).not.toContain("♠");
      expect(labels?.[0]).not.toContain("♡");
      expect(labels?.[0]).not.toContain("♢");
      expect(labels?.[0]).not.toContain("♣");
    });

    it("Test C: Request target (STAGE #1 アタック / targetedRequestIds の収集)", () => {
      const requests = [
        {
          id: "req-1",
          actionId: "action.attack",
          action: { name: "アタック" },
        },
        {
          id: "req-2",
          actionId: "action.counter",
          action: { name: "カウンター" },
          targets: [{ type: "request", targetRequestId: "req-1" }],
        },
      ];

      const presentation = StageTargetPresenter.buildStageTargetPresentation(requests);
      expect(presentation.targetedRequestIds.has("req-1")).toBe(true);

      const labels = presentation.requestTargetLabels.get("req-2");
      expect(labels).toBeDefined();
      expect(labels?.[0]).toBe("STAGE #1 アタック");
    });

    it("Test D: Mobile展開制御 (Counter対象のRequestがMobileで折りたたまれないこと)", () => {
      const requests = [
        {
          id: "req-1",
          actionId: "action.attack",
          action: { name: "アタック" },
          controller: "p1",
        },
        {
          id: "req-2",
          actionId: "action.counter",
          action: { name: "カウンター" },
          controller: "p2",
          targets: [{ type: "request", targetRequestId: "req-1" }],
        },
      ];

      const html = renderToString(
        React.createElement(StagePanel, {
          requests,
          highlightedRequestId: null,
        })
      );

      // req-1 に COUNTER TARGET バッジが表示されること
      expect(html).toContain("COUNTER TARGET");
      // req-1 は非TOPだが targetedRequestIds に含まれるため、hidden lg:flex にならない
      // HTML中に hidden lg:flex が含まれていないこと (全リクエストが表示対象)
      expect(html).not.toContain("hidden lg:flex");
    });

    it("Test E: 複数Targetの表示順序が維持されること", () => {
      const battleMap = new Map<string, UnitBattleDisplayInfo>([
        [
          "u-1",
          {
            unitId: "u-1",
            badge: "①",
            label: "① ♠A 英雄",
            blockedByBadges: [],
          },
        ],
        [
          "u-2",
          {
            unitId: "u-2",
            badge: "②",
            label: "② ♣2 一般兵",
            blockedByBadges: [],
          },
        ],
      ]);

      const requests = [
        {
          id: "req-multi",
          actionId: "action.dualAttack",
          targets: [
            { type: "unit", unitId: "u-2" },
            { type: "unit", unitId: "u-1" },
          ],
        },
      ];

      const presentation = StageTargetPresenter.buildStageTargetPresentation(requests, battleMap);
      const labels = presentation.requestTargetLabels.get("req-multi");

      expect(labels).toEqual(["② ♣2 一般兵", "① ♠A 英雄"]);
    });

    it("Test F: missing stable identity 時に推測せず fail-closed 表示になること", () => {
      const requests = [
        {
          id: "req-no-unit-id",
          actionId: "action.down",
          targets: [{ type: "unit" }], // unitId 欠落
        },
        {
          id: "req-no-req-id",
          actionId: "action.counter",
          targets: [{ type: "request" }], // requestId 欠落
        },
      ];

      const presentation = StageTargetPresenter.buildStageTargetPresentation(requests);
      const unitLabels = presentation.requestTargetLabels.get("req-no-unit-id");
      const reqLabels = presentation.requestTargetLabels.get("req-no-req-id");

      expect(unitLabels?.[0]).toBe("対象Unit（識別不能）");
      expect(reqLabels?.[0]).toBe("対象リクエスト（識別不能）");
    });

    it("Test G: Observation secrecy (raw GameState 経由の非公開情報が漏洩しないこと)", () => {
      // 相手の裏向きカードの情報が渡されない battleRelationMap
      const battleMap = new Map<string, UnitBattleDisplayInfo>([
        [
          "u-hidden-bulwark",
          {
            unitId: "u-hidden-bulwark",
            badge: "③",
            label: "③ 防壁",
            blockedByBadges: [],
          },
        ],
      ]);

      // raw targets にカード情報が含まれていない (unitId のみ)
      const requests = [
        {
          id: "req-target-bulwark",
          actionId: "action.destroyBulwark",
          targets: [{ type: "unit", unitId: "u-hidden-bulwark" }],
        },
      ];

      const presentation = StageTargetPresenter.buildStageTargetPresentation(requests, battleMap);
      const label = presentation.requestTargetLabels.get("req-target-bulwark")?.[0];

      expect(label).toBe("③ 防壁");
      expect(label).not.toMatch(/[♠♡♢♣]/);
    });

    it("Test H: Target lost (対象Unitが既に盤面から離脱している場合の安全な表示)", () => {
      // battleRelationMap に存在しない unitId
      const battleMap = new Map<string, UnitBattleDisplayInfo>();

      const requests = [
        {
          id: "req-lost",
          actionId: "action.down",
          targets: [{ type: "unit", unitId: "u-vanished" }],
        },
      ];

      const presentation = StageTargetPresenter.buildStageTargetPresentation(requests, battleMap);
      const labels = presentation.requestTargetLabels.get("req-lost");

      expect(labels?.[0]).toBe("対象Unit（現在盤面に存在しません）");
    });
  });
});
