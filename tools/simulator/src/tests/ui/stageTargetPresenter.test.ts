import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import {
  StageTargetPresenter,
  getStageRequestDisplayIndex,
} from "../../ui/game/StageTargetPresenter";
import type { ActionRequest } from "../../domain/rules/RulePackage";
import type { UnitBattleDisplayInfo } from "../../ui/game/BattleRelationPresenter";
import { StagePanel } from "../../ui/game/StagePanel";

describe("StageTargetPresenter (UI Phase 3.1-R1)", () => {
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
    it("Test A: 同種一般兵2体存在時のターゲット個別識別 (canonical unitId による盤面番号・カード・役職の付与)", () => {
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

      const requests: ActionRequest[] = [
        {
          id: "req-1",
          actionId: "action.down",
          controller: "p1",
          keyCards: [],
          status: "pending",
          sequence: 1,
          targets: [{ type: "unit", unitId: "u-soldier-2", kind: "soldier", componentId: "c-2" }],
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

      const requests: ActionRequest[] = [
        {
          id: "req-destroy-bulwark",
          actionId: "action.destroyBulwark",
          controller: "p1",
          keyCards: [],
          status: "pending",
          sequence: 1,
          targets: [{ type: "unit", unitId: "u-bulwark-opp", kind: "bulwark", componentId: "c-4" }],
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

    it("Test C: Request target (canonical requestId による STAGE #1 アタック / targetedRequestIds の収集)", () => {
      const requests: ActionRequest[] = [
        {
          id: "req-1",
          actionId: "action.attack",
          controller: "p1",
          keyCards: [],
          status: "pending",
          sequence: 1,
          action: { id: "action.attack", name: "アタック", timing: "turn", description: "" } as any,
        },
        {
          id: "req-2",
          actionId: "action.counter",
          controller: "p2",
          keyCards: [],
          status: "pending",
          sequence: 2,
          action: { id: "action.counter", name: "カウンター", timing: "turn", description: "" } as any,
          targets: [{ type: "request", requestId: "req-1", actionId: "action.attack" }],
        },
      ];

      const presentation = StageTargetPresenter.buildStageTargetPresentation(requests);
      expect(presentation.targetedRequestIds.has("req-1")).toBe(true);

      const labels = presentation.requestTargetLabels.get("req-2");
      expect(labels).toBeDefined();
      expect(labels?.[0]).toBe("STAGE #1 アタック");
    });

    it("Test D: Mobile展開制御 & Generic TARGET indicator (Counter固有ではなくgeneric TARGETバッジであること)", () => {
      const requests: ActionRequest[] = [
        {
          id: "req-1",
          actionId: "action.attack",
          controller: "p1",
          keyCards: [],
          status: "pending",
          sequence: 1,
          action: { id: "action.attack", name: "アタック", timing: "turn", description: "" } as any,
        },
        {
          id: "req-2",
          actionId: "action.counter",
          controller: "p2",
          keyCards: [],
          status: "pending",
          sequence: 2,
          action: { id: "action.counter", name: "カウンター", timing: "turn", description: "" } as any,
          targets: [{ type: "request", requestId: "req-1", actionId: "action.attack" }],
        },
      ];

      const html = renderToString(
        React.createElement(StagePanel, {
          requests,
          highlightedRequestId: null,
        })
      );

      // generic TARGET バッジが表示されること (COUNTER TARGET ではない)
      expect(html).toContain("TARGET");
      expect(html).not.toContain("COUNTER TARGET");
      expect(html).toContain("別のアクションから対象として指定されています");
      // req-1 は非TOPだが targetedRequestIds に含まれるため、hidden lg:flex にならない
      expect(html).not.toContain("hidden lg:flex");
    });

    it("Test E: 複数Targetの表示順序が維持されること (canonical ActionRequestTarget)", () => {
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

      const requests: ActionRequest[] = [
        {
          id: "req-multi",
          actionId: "action.dualAttack",
          controller: "p1",
          keyCards: [],
          status: "pending",
          sequence: 1,
          targets: [
            { type: "unit", unitId: "u-2", kind: "soldier", componentId: "c-2" },
            { type: "unit", unitId: "u-1", kind: "hero", componentId: "c-1" },
          ],
        },
      ];

      const presentation = StageTargetPresenter.buildStageTargetPresentation(requests, battleMap);
      const labels = presentation.requestTargetLabels.get("req-multi");

      expect(labels).toEqual(["② ♣2 一般兵", "① ♠A 英雄"]);
    });

    it("Test F: displayName/card/action名/配列位置等からidentityを推測しないこと", () => {
      // canonical targets が空または未指定の場合、推測によるラベル生成を絶対に行わない
      const requests: ActionRequest[] = [
        {
          id: "req-no-targets",
          actionId: "action.attack",
          controller: "p1",
          keyCards: [],
          status: "pending",
          sequence: 1,
          targets: [],
        },
      ];

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
      ]);

      const presentation = StageTargetPresenter.buildStageTargetPresentation(requests, battleMap);
      expect(presentation.requestTargetLabels.get("req-no-targets")).toBeUndefined();
      expect(presentation.targetedRequestIds.size).toBe(0);
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
      const requests: ActionRequest[] = [
        {
          id: "req-target-bulwark",
          actionId: "action.destroyBulwark",
          controller: "p1",
          keyCards: [],
          status: "pending",
          sequence: 1,
          targets: [{ type: "unit", unitId: "u-hidden-bulwark", kind: "bulwark", componentId: "c-3" }],
        },
      ];

      const presentation = StageTargetPresenter.buildStageTargetPresentation(requests, battleMap);
      const label = presentation.requestTargetLabels.get("req-target-bulwark")?.[0];

      expect(label).toBe("③ 防壁");
      expect(label).not.toMatch(/[♠♡♢♣]/);
    });

    it("Test H: Target lost (対象Unitまたは対象Requestが既に離脱している場合の安全な表示)", () => {
      // battleRelationMap に存在しない unitId
      const battleMap = new Map<string, UnitBattleDisplayInfo>();

      const requests: ActionRequest[] = [
        {
          id: "req-lost-unit",
          actionId: "action.down",
          controller: "p1",
          keyCards: [],
          status: "pending",
          sequence: 1,
          targets: [{ type: "unit", unitId: "u-vanished", kind: "soldier", componentId: "c-v" }],
        },
        {
          id: "req-lost-request",
          actionId: "action.counter",
          controller: "p2",
          keyCards: [],
          status: "pending",
          sequence: 2,
          targets: [{ type: "request", requestId: "req-resolved-earlier", actionId: "action.attack" }],
        },
      ];

      const presentation = StageTargetPresenter.buildStageTargetPresentation(requests, battleMap);
      const unitLabels = presentation.requestTargetLabels.get("req-lost-unit");
      const reqLabels = presentation.requestTargetLabels.get("req-lost-request");

      expect(unitLabels?.[0]).toBe("対象Unit（現在盤面に存在しません）");
      expect(reqLabels?.[0]).toBe("対象リクエスト（解決済み）");
    });
  });
});
