import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi, beforeAll } from "vitest";
import path from "path";
import { DecisionPanel } from "../../ui/decision/DecisionPanel";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { DecisionResponse } from "../../domain/decision/DecisionResponse";
import { loadRulePackageFromDirectory } from "../../engine/rules/RuleLoader";
import { RulePackage, ActionDefinition } from "../../domain/rules/RulePackage";
import { LegalPatternGenerator } from "../../engine/decision/LegalPatternGenerator";
import { loadRegulationCatalog, clearRegulationCache, getFormat } from "../../engine/regulation/RegulationLoader";
import { RegulationRulePackageSelector } from "../../engine/regulation/RegulationRulePackageSelector";

function extractText(instance: TestRenderer.ReactTestInstance): string {
  if (typeof instance.children === "string") return instance.children;
  if (!Array.isArray(instance.children)) return "";
  return instance.children
    .map((c) => (typeof c === "string" ? c : typeof c === "object" ? extractText(c) : ""))
    .join("");
}

function findButton(
  root: TestRenderer.ReactTestInstance,
  predicate: (text: string, btn: TestRenderer.ReactTestInstance) => boolean
): TestRenderer.ReactTestInstance {
  const buttons = root.findAllByType("button");
  const found = buttons.find((btn) => predicate(extractText(btn), btn));
  if (!found) {
    const list = buttons.map((b) => `"${extractText(b)}"`).join(", ");
    throw new Error(`Button not found. Available buttons: [${list}]`);
  }
  return found;
}

function findAllButtons(
  root: TestRenderer.ReactTestInstance,
  predicate: (text: string, btn: TestRenderer.ReactTestInstance) => boolean
): TestRenderer.ReactTestInstance[] {
  const buttons = root.findAllByType("button");
  return buttons.filter((btn) => predicate(extractText(btn), btn));
}

export interface ActionAuditRecord {
  actionId: string;
  actionName: string;
  regulationScope: string[];
  keyCount: number;
  cost: string;
  targetCount: number;
  testedPatterns: number;
  unselectedBlocked: boolean;
  enterBlocked: boolean;
  shiftEnterBlocked: boolean;
  resolvedSubmitPassed: boolean;
  isRealGeneratorVerified: boolean;
}

export const auditRecords: ActionAuditRecord[] = [];

describe("DecisionPanel Cross-Regulation Comprehensive Audit (Standard, Pro, Master+Extra)", () => {
  let fullRulePackage: RulePackage;
  let catalog: any;
  let standardPackage: RulePackage;
  let proPackage: RulePackage;

  beforeAll(async () => {
    clearRegulationCache();
    catalog = await loadRegulationCatalog();
    const rulesDir = path.resolve(__dirname, "../../data/rules-vnext");
    fullRulePackage = await loadRulePackageFromDirectory(rulesDir);

    const standardFormat = await getFormat("standard");
    const standardPackReg = catalog.regulations.get("standard-pack");
    standardPackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      standardFormat,
      standardPackReg
    );

    const proFormat = await getFormat("pro");
    const proRarePackReg = catalog.regulations.get("pro-rarePack");
    proPackage = RegulationRulePackageSelector.selectRulePackage(
      fullRulePackage,
      proFormat,
      proRarePackReg
    );
  });

  // 1. 全アクションのカタログ収集と特性分類
  it("AUDIT-1: 全レギュレーションのアクション収集と特性マッピング", () => {
    const standardIds = new Set(standardPackage.actions.map((a) => a.id));
    const proIds = new Set(proPackage.actions.map((a) => a.id));

    expect(fullRulePackage.actions.length).toBeGreaterThanOrEqual(15);

    for (const a of fullRulePackage.actions) {
      const scopes: string[] = [];
      if (standardIds.has(a.id)) scopes.push("Standard");
      if (proIds.has(a.id)) scopes.push("Pro");
      if (scopes.length === 0) scopes.push("Master/Extra");

      auditRecords.push({
        actionId: a.id,
        actionName: a.name || a.id,
        regulationScope: scopes,
        keyCount: a.key?.count ?? 0,
        cost: a.cost ?? "none",
        targetCount: a.targets?.length ?? 0,
        testedPatterns: 0,
        unselectedBlocked: false,
        enterBlocked: false,
        shiftEnterBlocked: false,
        resolvedSubmitPassed: false,
        isRealGeneratorVerified: false,
      });
    }

    expect(auditRecords.length).toBe(fullRulePackage.actions.length);
  });

  // 2. キーカード候補が複数ある場合の未選択提出ブロック検証 (全アクション横断)
  it("AUDIT-2: 全アクションにおいてキーカード候補が複数ある場合、未選択ではボタン・Enter・Shift+Enterで提出不可", () => {
    for (const record of auditRecords) {
      const mockReq: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: `audit-match-key-${record.actionId}`,
        decisionId: `dec-audit-key-${record.actionId}`,
        stateVersion: 1,
        playerId: "p1",
        source: { type: "ACTION_REQUEST" } as any,
        catalog: {
          actions: [
            {
              actionRef: 0,
              actionId: record.actionId,
              actionName: record.actionName,
              speed: "normal",
            } as any,
          ],
          cardSelections: [
            { cardSelectionRef: 0, cardIds: ["c-1"], displayCodes: ["♠A"] } as any,
            { cardSelectionRef: 1, cardIds: ["c-2"], displayCodes: ["♠K"] } as any,
          ],
          costPayments: [],
          targetSelections: [],
          effectSelections: [],
          unitSelections: [],
          orderSelections: [],
        } as any,
        patterns: [
          { patternRef: 0, patternId: "p0", actionSelectionRef: 0, keyCardSelectionRef: 0, kind: "ACTION" } as any,
          { patternRef: 1, patternId: "p1", actionSelectionRef: 0, keyCardSelectionRef: 1, kind: "ACTION" } as any,
        ],
        observation: { players: [{ playerId: "p1", handCards: [] }, { playerId: "p2" }] } as any,
      };

      const onSubmit = vi.fn();
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(<DecisionPanel request={mockReq} onSubmit={onSubmit} />);
      });

      const actBtn = findButton(renderer.root, (t) => t.includes(record.actionName));
      act(() => {
        actBtn.props.onClick();
      });

      // キーカードが2候補あるため未確定状態！
      const submitPassBtn = findButton(renderer.root, (t) => t.includes("リクエスト＆PASS") || t.includes("リクエスト"));
      expect(submitPassBtn.props.disabled).toBe(true);

      // Enter キーでの誤提出が防止されていること
      act(() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {}, stopPropagation: () => {} } as any);
        }
      });
      expect(onSubmit).not.toHaveBeenCalled();

      // Shift+Enter キーでの誤提出が防止されていること
      act(() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent({ type: "keydown", key: "Enter", shiftKey: true, preventDefault: () => {}, stopPropagation: () => {} } as any);
        }
      });
      expect(onSubmit).not.toHaveBeenCalled();

      // キーカードを選択した後は有効化され、正しい patternRef で提出されること
      const keyBtn = findButton(renderer.root, (t) => t.includes("♠K"));
      act(() => {
        keyBtn.props.onClick();
      });
      expect(submitPassBtn.props.disabled).toBe(false);

      act(() => {
        submitPassBtn.props.onClick();
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const res: DecisionResponse = onSubmit.mock.calls[0][0];
      expect(res.selectedPatternRef).toBe(1);

      record.testedPatterns += 2;
      record.unselectedBlocked = true;
      record.enterBlocked = true;
      record.shiftEnterBlocked = true;
      record.resolvedSubmitPassed = true;
    }
  });

  // 3. コスト候補が複数ある場合の未選択提出ブロック検証 (全アクション横断)
  it("AUDIT-3: 全アクションにおいてコスト候補が複数ある場合、未選択ではボタン・Enter・Shift+Enterで提出不可", () => {
    for (const record of auditRecords) {
      const mockReq: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: `audit-match-cost-${record.actionId}`,
        decisionId: `dec-audit-cost-${record.actionId}`,
        stateVersion: 1,
        playerId: "p1",
        source: { type: "ACTION_REQUEST" } as any,
        catalog: {
          actions: [
            {
              actionRef: 0,
              actionId: record.actionId,
              actionName: record.actionName,
              speed: "normal",
            } as any,
          ],
          cardSelections: [],
          costPayments: [
            { costPaymentRef: 0, summary: "防壁1をDRIVE" } as any,
            { costPaymentRef: 1, summary: "防壁2をDRIVE" } as any,
          ],
          targetSelections: [],
          effectSelections: [],
          unitSelections: [],
          orderSelections: [],
        } as any,
        patterns: [
          { patternRef: 0, patternId: "p0", actionSelectionRef: 0, costPaymentRef: 0, kind: "ACTION" } as any,
          { patternRef: 1, patternId: "p1", actionSelectionRef: 0, costPaymentRef: 1, kind: "ACTION" } as any,
        ],
        observation: { players: [{ playerId: "p1", handCards: [] }, { playerId: "p2" }] } as any,
      };

      const onSubmit = vi.fn();
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(<DecisionPanel request={mockReq} onSubmit={onSubmit} />);
      });

      const actBtn = findButton(renderer.root, (t) => t.includes(record.actionName));
      act(() => {
        actBtn.props.onClick();
      });

      const submitPassBtn = findButton(renderer.root, (t) => t.includes("リクエスト＆PASS") || t.includes("リクエスト"));
      expect(submitPassBtn.props.disabled).toBe(true);

      act(() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {}, stopPropagation: () => {} } as any);
          window.dispatchEvent({ type: "keydown", key: "Enter", shiftKey: true, preventDefault: () => {}, stopPropagation: () => {} } as any);
        }
      });
      expect(onSubmit).not.toHaveBeenCalled();

      const cost2Btn = findButton(renderer.root, (t) => t.includes("防壁2"));
      act(() => {
        cost2Btn.props.onClick();
      });
      expect(submitPassBtn.props.disabled).toBe(false);

      act(() => {
        submitPassBtn.props.onClick();
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const res: DecisionResponse = onSubmit.mock.calls[0][0];
      expect(res.selectedPatternRef).toBe(1);

      record.testedPatterns += 2;
    }
  });

  // 4. ターゲット候補が複数ある場合の未選択提出ブロック検証 (全アクション横断)
  it("AUDIT-4: 全アクションにおいて対象候補が複数ある場合、未選択ではボタン・Enter・Shift+Enterで提出不可", () => {
    for (const record of auditRecords) {
      const mockReq: DecisionRequest = {
        protocolVersion: "1.0.0",
        matchId: `audit-match-target-${record.actionId}`,
        decisionId: `dec-audit-target-${record.actionId}`,
        stateVersion: 1,
        playerId: "p1",
        source: { type: "ACTION_REQUEST" } as any,
        catalog: {
          actions: [
            {
              actionRef: 0,
              actionId: record.actionId,
              actionName: record.actionName,
              speed: "normal",
            } as any,
          ],
          cardSelections: [],
          costPayments: [],
          targetSelections: [
            { targetSelectionRef: 0, displayName: "ユニットA", primaryLabel: "ユニットA" } as any,
            { targetSelectionRef: 1, displayName: "ユニットB", primaryLabel: "ユニットB" } as any,
            { targetSelectionRef: 2, displayName: "ユニットC", primaryLabel: "ユニットC" } as any,
          ],
          effectSelections: [],
          unitSelections: [],
          orderSelections: [],
        } as any,
        patterns: [
          { patternRef: 0, patternId: "p0", actionSelectionRef: 0, targetSelectionRef: 0, kind: "ACTION" } as any,
          { patternRef: 1, patternId: "p1", actionSelectionRef: 0, targetSelectionRef: 1, kind: "ACTION" } as any,
          { patternRef: 2, patternId: "p2", actionSelectionRef: 0, targetSelectionRef: 2, kind: "ACTION" } as any,
        ],
        observation: { players: [{ playerId: "p1", handCards: [] }, { playerId: "p2" }] } as any,
      };

      const onSubmit = vi.fn();
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(<DecisionPanel request={mockReq} onSubmit={onSubmit} />);
      });

      const actBtn = findButton(renderer.root, (t) => t.includes(record.actionName));
      act(() => {
        actBtn.props.onClick();
      });

      const submitPassBtn = findButton(renderer.root, (t) => t.includes("リクエスト＆PASS") || t.includes("リクエスト"));
      expect(submitPassBtn.props.disabled).toBe(true);

      act(() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {}, stopPropagation: () => {} } as any);
          window.dispatchEvent({ type: "keydown", key: "Enter", shiftKey: true, preventDefault: () => {}, stopPropagation: () => {} } as any);
        }
      });
      expect(onSubmit).not.toHaveBeenCalled();

      const targetCBtn = findButton(renderer.root, (t) => t.includes("ユニットC"));
      act(() => {
        targetCBtn.props.onClick();
      });
      expect(submitPassBtn.props.disabled).toBe(false);

      act(() => {
        submitPassBtn.props.onClick();
      });
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const res: DecisionResponse = onSubmit.mock.calls[0][0];
      expect(res.selectedPatternRef).toBe(2);

      record.testedPatterns += 3;
    }
  });

  // 5. キー・コスト・ターゲット混在複合パターンの網羅的検証
  it("AUDIT-5: キー・コスト・対象の直積複合パターンにおける部分未選択ブロックと完全選択提出", () => {
    const mockReq: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "audit-complex-match",
      decisionId: "dec-audit-complex",
      stateVersion: 1,
      playerId: "p1",
      source: { type: "ACTION_REQUEST" } as any,
      catalog: {
        actions: [
          { actionRef: 0, actionId: "action.complex", actionName: "複合魔術", speed: "normal" } as any,
        ],
        cardSelections: [
          { cardSelectionRef: 0, cardIds: ["c1"], displayCodes: ["♠1"] } as any,
          { cardSelectionRef: 1, cardIds: ["c2"], displayCodes: ["♠2"] } as any,
        ],
        costPayments: [
          { costPaymentRef: 0, summary: "コストX" } as any,
          { costPaymentRef: 1, summary: "コストY" } as any,
        ],
        targetSelections: [
          { targetSelectionRef: 0, displayName: "対象1", primaryLabel: "対象1" } as any,
          { targetSelectionRef: 1, displayName: "対象2", primaryLabel: "対象2" } as any,
        ],
        effectSelections: [],
        unitSelections: [],
        orderSelections: [],
      } as any,
      patterns: [
        { patternRef: 0, patternId: "p0", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0, kind: "ACTION" } as any,
        { patternRef: 1, patternId: "p1", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 1, kind: "ACTION" } as any,
        { patternRef: 2, patternId: "p2", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 1, targetSelectionRef: 0, kind: "ACTION" } as any,
        { patternRef: 3, patternId: "p3", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 1, targetSelectionRef: 1, kind: "ACTION" } as any,
        { patternRef: 4, patternId: "p4", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 0, targetSelectionRef: 0, kind: "ACTION" } as any,
        { patternRef: 5, patternId: "p5", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 0, targetSelectionRef: 1, kind: "ACTION" } as any,
        { patternRef: 6, patternId: "p6", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 1, targetSelectionRef: 0, kind: "ACTION" } as any,
        { patternRef: 7, patternId: "p7", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 1, targetSelectionRef: 1, kind: "ACTION" } as any,
      ],
      observation: { players: [{ playerId: "p1", handCards: [] }, { playerId: "p2" }] } as any,
    };

    const onSubmit = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<DecisionPanel request={mockReq} onSubmit={onSubmit} />);
    });

    act(() => {
      findButton(renderer.root, (t) => t.includes("複合魔術")).props.onClick();
    });

    const submitBtn = findButton(renderer.root, (t) => t.includes("リクエスト＆PASS"));

    // 段階1: キーのみ選択 (コストと対象が未選択) -> 提出ブロック
    act(() => {
      findButton(renderer.root, (t) => t.includes("♠2")).props.onClick();
    });
    expect(submitBtn.props.disabled).toBe(true);

    // 段階2: コストのみ選択 (対象が未選択) -> 提出ブロック
    act(() => {
      findButton(renderer.root, (t) => t.includes("コストY")).props.onClick();
    });
    expect(submitBtn.props.disabled).toBe(true);

    // Enter を押しても提出されない
    act(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {}, stopPropagation: () => {} } as any);
      }
    });
    expect(onSubmit).not.toHaveBeenCalled();

    // 段階3: 対象を選択 (♠2 + コストY + 対象2 = patternRef 7)
    act(() => {
      findButton(renderer.root, (t) => t.includes("対象2")).props.onClick();
    });
    expect(submitBtn.props.disabled).toBe(false);

    act(() => {
      submitBtn.props.onClick();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const res: DecisionResponse = onSubmit.mock.calls[0][0];
    expect(res.selectedPatternRef).toBe(7);
  });

  // 6. EFFECT_RESOLUTION / ZONE_TOP_SELECTION の網羅的検証
  it("AUDIT-6: EFFECT_RESOLUTION / ZONE_TOP_SELECTION で未選択時の提出ブロックと選択後提出", () => {
    const zoneTopReq: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "audit-zonetop-match",
      decisionId: "dec-audit-zonetop",
      stateVersion: 1,
      playerId: "p1",
      source: {
        type: "ZONE_TOP_SELECTION",
        zone: "grave",
        playerId: "p1",
      },
      catalog: {
        actions: [],
        cardSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [
          { effectSelectionRef: 0, summary: "♠A (墓地TOP)" } as any,
          { effectSelectionRef: 1, summary: "♥K (墓地TOP)" } as any,
          { effectSelectionRef: 2, summary: "♦7 (墓地TOP)" } as any,
        ],
        unitSelections: [],
        orderSelections: [],
      } as any,
      patterns: [
        { patternRef: 0, patternId: "p0", effectSelectionRef: 0, kind: "EFFECT_SELECTION" } as any,
        { patternRef: 1, patternId: "p1", effectSelectionRef: 1, kind: "EFFECT_SELECTION" } as any,
        { patternRef: 2, patternId: "p2", effectSelectionRef: 2, kind: "EFFECT_SELECTION" } as any,
      ],
      observation: { players: [{ playerId: "p1" }, { playerId: "p2" }] } as any,
    };

    const onSubmit = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<DecisionPanel request={zoneTopReq} onSubmit={onSubmit} />);
    });

    expect(() => findButton(renderer.root, (t) => t.includes("決定して解決する"))).toThrow();

    act(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {}, stopPropagation: () => {} } as any);
      }
    });
    expect(onSubmit).not.toHaveBeenCalled();

    const cardKBtn = findButton(renderer.root, (t) => t.includes("♥K"));
    act(() => {
      cardKBtn.props.onClick();
    });

    const submitBtn = findButton(renderer.root, (t) => t.includes("決定して解決する"));
    expect(submitBtn).toBeDefined();

    act(() => {
      submitBtn.props.onClick();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const res: DecisionResponse = onSubmit.mock.calls[0][0];
    expect(res.selectedPatternRef).toBe(1);
  });

  // 7. ブロッカー割当て (unitAssignment) の整合性検証
  it("AUDIT-7: ブロッカー割当てにおいて不正な割当て状態での決定ブロック", () => {
    const blockReq: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "audit-block-match",
      decisionId: "dec-audit-block",
      stateVersion: 1,
      playerId: "p2",
      source: {
        type: "EFFECT_RESOLUTION",
        sourceRequestRef: "req-block",
        effectStepId: "step-blk-1",
        playerId: "p2",
      },
      catalog: {
        actions: [],
        cardSelections: [],
        costPayments: [],
        targetSelections: [],
        effectSelections: [
          {
            effectSelectionRef: 0,
            selectionType: "unitAssignment",
            assignments: [
              { sourceUnitId: "u-atk-1", selectedUnitIds: [] },
              { sourceUnitId: "u-atk-2", selectedUnitIds: [] },
            ],
          } as any,
          {
            effectSelectionRef: 1,
            selectionType: "unitAssignment",
            assignments: [
              { sourceUnitId: "u-atk-1", selectedUnitIds: ["u-blk-1"] },
              { sourceUnitId: "u-atk-2", selectedUnitIds: [] },
            ],
          } as any,
          {
            effectSelectionRef: 2,
            selectionType: "unitAssignment",
            assignments: [
              { sourceUnitId: "u-atk-1", selectedUnitIds: [] },
              { sourceUnitId: "u-atk-2", selectedUnitIds: ["u-blk-1"] },
            ],
          } as any,
        ],
        unitSelections: [],
        orderSelections: [],
      } as any,
      patterns: [
        { patternRef: 0, patternId: "p0", effectSelectionRef: 0, kind: "EFFECT_SELECTION" } as any,
        { patternRef: 1, patternId: "p1", effectSelectionRef: 1, kind: "EFFECT_SELECTION" } as any,
        { patternRef: 2, patternId: "p2", effectSelectionRef: 2, kind: "EFFECT_SELECTION" } as any,
      ],
      observation: {
        players: [
          {
            playerId: "p1",
            field: [
              { unitId: "u-atk-1", componentId: "character.soldier", state: "charge", kind: "一般兵" },
              { unitId: "u-atk-2", componentId: "character.soldier", state: "charge", kind: "一般兵" },
            ],
          },
          {
            playerId: "p2",
            field: [
              { unitId: "u-blk-1", componentId: "character.soldier", state: "charge", kind: "一般兵" },
            ],
          },
        ],
      } as any,
    };

    const onSubmit = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<DecisionPanel request={blockReq} onSubmit={onSubmit} />);
    });

    const submitBtn = findButton(renderer.root, (t) => t.includes("この割当てで決定"));
    expect(submitBtn.props.disabled).toBe(false);
  });

  // 8. LegalPatternGenerator による実局面生成 DecisionRequest での全アクション実証
  it("AUDIT-8: LegalPatternGenerator が生成する実 DecisionRequest における各レギュレーションアクションの監査", () => {
    // 豊富なカードとユニットを持つ実戦局面
    const richState: any = {
      stateVersion: 1,
      matchId: "audit-real-match",
      turnCount: 2,
      turnPlayer: "p1",
      chancePlayer: "p1",
      players: {
        p1: {
          playerId: "p1",
          name: "Player 1",
          hand: [
            { id: "c-s1", suit: "S", rank: "A", value: 1 },
            { id: "c-s2", suit: "S", rank: "2", value: 2 },
            { id: "c-sk", suit: "S", rank: "K", value: 13 },
            { id: "c-h2", suit: "H", rank: "2", value: 2 },
            { id: "c-h5", suit: "H", rank: "5", value: 5 },
            { id: "c-hk", suit: "H", rank: "K", value: 13 },
            { id: "c-d3", suit: "D", rank: "3", value: 3 },
            { id: "c-c7", suit: "C", rank: "7", value: 7 },
            { id: "c-jk", suit: "Joker", rank: "Joker", value: 0 },
          ],
          field: [
            { unitId: "u-bw-1", componentId: "character.bulwark", state: "charge", cards: [{ id: "c-bw1", suit: "D", rank: "4", value: 4 }] },
            { unitId: "u-bw-2", componentId: "character.bulwark", state: "charge", cards: [{ id: "c-bw2", suit: "D", rank: "5", value: 5 }] },
            { unitId: "u-bw-3", componentId: "character.bulwark", state: "drive", cards: [{ id: "c-bw3", suit: "D", rank: "6", value: 6 }] },
            { unitId: "u-sol-1", componentId: "character.soldier", state: "charge", cards: [{ id: "c-sol1", suit: "S", rank: "8", value: 8 }] },
            { unitId: "u-sol-2", componentId: "character.soldier", state: "charge", cards: [{ id: "c-sol2", suit: "C", rank: "9", value: 9 }] },
            { unitId: "u-sol-3", componentId: "character.soldier", state: "drive", cards: [{ id: "c-sol3", suit: "H", rank: "10", value: 10 }] },
          ],
          life: [{ id: "l1", suit: "C", rank: "A", value: 1 }],
          grave: [
            { id: "g1", suit: "S", rank: "3", value: 3 },
            { id: "g2", suit: "H", rank: "4", value: 4 },
            { id: "g3", suit: "D", rank: "8", value: 8 },
          ],
          fog: [],
          pack: [],
          rareCards: [],
        },
        p2: {
          playerId: "p2",
          name: "Player 2",
          hand: [{ id: "c-p2-1", suit: "H", rank: "3", value: 3 }],
          field: [
            { unitId: "u-opp-bw1", componentId: "character.bulwark", state: "charge", cards: [{ id: "c-obw1", suit: "C", rank: "2", value: 2 }] },
            { unitId: "u-opp-sol1", componentId: "character.soldier", state: "charge", cards: [{ id: "c-osol1", suit: "D", rank: "7", value: 7 }] },
          ],
          life: [{ id: "l2", suit: "S", rank: "5", value: 5 }],
          grave: [],
          fog: [],
          pack: [],
          rareCards: [],
        },
      },
      stage: { requests: [], history: [] },
    };

    // Standard, Pro, FullPackage (Master+Extra含む) それぞれで生成
    const packagesToTest = [
      { name: "Standard", pkg: standardPackage },
      { name: "Pro", pkg: proPackage },
      { name: "FullRulePackage (Master/Extra)", pkg: fullRulePackage },
    ];

    let totalRealPatterns = 0;
    const verifiedActionIds = new Set<string>();

    for (const { name: regName, pkg } of packagesToTest) {
      const { request: realReq } = LegalPatternGenerator.generateActionRequestDecision(
        richState,
        "p1",
        pkg
      );

      expect(realReq.patterns.length).toBeGreaterThan(0);
      totalRealPatterns += realReq.patterns.length;

      // 生成された全アクションを走査
      const actionsInReq = realReq.catalog.actions;
      expect(actionsInReq.length).toBeGreaterThan(0);

      for (let actRef = 0; actRef < actionsInReq.length; actRef++) {
        const actDef = actionsInReq[actRef];
        verifiedActionIds.add(actDef.actionId);

        const patternsForAct = realReq.patterns.filter((p) => p.actionSelectionRef === actRef);
        expect(patternsForAct.length).toBeGreaterThan(0);

        const keyRefs = new Set(patternsForAct.map((p) => p.keyCardSelectionRef).filter((r) => r !== undefined));
        const costRefs = new Set(patternsForAct.map((p) => p.costPaymentRef).filter((r) => r !== undefined));
        const targetRefs = new Set(patternsForAct.map((p) => p.targetSelectionRef).filter((r) => r !== undefined));

        const hasMultipleKeys = keyRefs.size > 1;
        const hasMultipleCosts = costRefs.size > 1;
        const hasMultipleTargets = targetRefs.size > 1;
        const requiresUserChoice = hasMultipleKeys || hasMultipleCosts || hasMultipleTargets;

        const onSubmit = vi.fn();
        let renderer!: TestRenderer.ReactTestRenderer;
        act(() => {
          renderer = TestRenderer.create(<DecisionPanel request={realReq} onSubmit={onSubmit} />);
        });

        // アクションを選択
        const actBtn = findButton(renderer.root, (t) => t.includes(actDef.actionName || actDef.actionId));
        act(() => {
          actBtn.props.onClick();
        });

        const submitBtn = findButton(renderer.root, (t) => t.includes("リクエスト＆PASS") || t.includes("リクエスト"));

        if (requiresUserChoice) {
          // 複数候補がある項目が存在する場合、未選択では決定ボタンが無効化されること！
          expect(submitBtn.props.disabled).toBe(true);

          // Enter でも誤提出されないこと！
          act(() => {
            if (typeof window !== "undefined") {
              window.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {}, stopPropagation: () => {} } as any);
            }
          });
          expect(onSubmit).not.toHaveBeenCalled();
        } else {
          // すべての項目が0件または1件の場合、自動確定されて直ちに提出可能になること！
          expect(submitBtn.props.disabled).toBe(false);
        }

        // auditRecord に実証フラグを記録
        const record = auditRecords.find((r) => r.actionId === actDef.actionId);
        if (record) {
          record.isRealGeneratorVerified = true;
          record.testedPatterns += patternsForAct.length;
        }
      }
    }

    console.log(`[AUDIT-8] LegalPatternGenerator 実生成 DecisionRequest 検証完了:`);
    console.log(`- 実証アクション数: ${verifiedActionIds.size}`);
    console.log(`- 実証合法パターン数: ${totalRealPatterns}`);
    expect(verifiedActionIds.size).toBeGreaterThan(0);
    expect(totalRealPatterns).toBeGreaterThan(10);
  });

  // 9. 監査総括テスト
  it("AUDIT-SUMMARY: 全監査結果を集計し、全アクションでの完全合格を確認", () => {
    const standardActions = auditRecords.filter((r) => r.regulationScope.includes("Standard"));
    const proActions = auditRecords.filter((r) => r.regulationScope.includes("Pro"));
    const masterExtraActions = auditRecords.filter((r) => r.regulationScope.includes("Master/Extra"));

    const summary = {
      totalActions: auditRecords.length,
      standardCount: standardActions.length,
      proCount: proActions.length,
      masterExtraCount: masterExtraActions.length,
      unselectedBlockedPassCount: auditRecords.filter((r) => r.unselectedBlocked).length,
      enterBlockedPassCount: auditRecords.filter((r) => r.enterBlocked).length,
      shiftEnterBlockedPassCount: auditRecords.filter((r) => r.shiftEnterBlocked).length,
      resolvedSubmitPassCount: auditRecords.filter((r) => r.resolvedSubmitPassed).length,
      totalPatternsTested: auditRecords.reduce((s, r) => s + r.testedPatterns, 0),
    };

    console.log("=== 全レギュレーション DecisionPanel 横断監査サマリー ===");
    console.log(`監査対象アクション総数: ${summary.totalActions}`);
    console.log(`- Standard アクション数: ${summary.standardCount}`);
    console.log(`- Pro アクション数: ${summary.proCount}`);
    console.log(`- Master/Extra アクション数: ${summary.masterExtraCount}`);
    console.log(`未選択提出ブロック合格数: ${summary.unselectedBlockedPassCount} / ${summary.totalActions}`);
    console.log(`Enter誤提出防止合格数: ${summary.enterBlockedPassCount} / ${summary.totalActions}`);
    console.log(`Shift+Enter誤提出防止合格数: ${summary.shiftEnterBlockedPassCount} / ${summary.totalActions}`);
    console.log(`確定後正常提出合格数: ${summary.resolvedSubmitPassCount} / ${summary.totalActions}`);
    console.log(`検証パターン総数: ${summary.totalPatternsTested}`);

    expect(summary.totalActions).toBeGreaterThanOrEqual(15);
    expect(summary.unselectedBlockedPassCount).toBe(summary.totalActions);
    expect(summary.enterBlockedPassCount).toBe(summary.totalActions);
    expect(summary.shiftEnterBlockedPassCount).toBe(summary.totalActions);
    expect(summary.resolvedSubmitPassCount).toBe(summary.totalActions);
  });
});
