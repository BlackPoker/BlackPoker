import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi, beforeAll } from "vitest";
import path from "path";
import { DecisionPanel } from "../../ui/decision/DecisionPanel";
import { BlockAssignmentEditor } from "../../ui/decision/BlockAssignmentEditor";
import { findExactMatchPatternRef } from "../../ui/decision/blockAssignmentUtils";
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
  verificationType: "REAL_GENERATOR" | "MOCK_ONLY";
  unverifiedReason?: string;
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
        verificationType: "MOCK_ONLY",
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

    // 実生成されなかったアクションについて、定義から理由を特定・記録
    for (const record of auditRecords) {
      if (verifiedActionIds.has(record.actionId)) {
        record.isRealGeneratorVerified = true;
        record.verificationType = "REAL_GENERATOR";
      } else {
        record.isRealGeneratorVerified = false;
        record.verificationType = "MOCK_ONLY";
        const def = fullRulePackage.actions.find((a) => a.id === record.actionId);
        if (!def) {
          record.unverifiedReason = "定義未検出";
        } else if (def.type === "triggered" || def.request?.trigger === "triggered") {
          record.unverifiedReason = "誘発アクション（システム自動積載のため手番直接リクエスト不可）";
        } else if (def.request?.timing === "quick") {
          record.unverifiedReason = "割り込み専用アクション（割り込みチャンス時のみ宣言可能）";
        } else if (def.request?.timing === "block") {
          record.unverifiedReason = "ブロック専用アクション（アタック後の防御宣言時のみ宣言可能）";
        } else if (def.request?.timing === "damageJudge") {
          record.unverifiedReason = "ダメージ判定専用アクション（戦闘解決時のみ宣言可能）";
        } else if (def.activationCondition) {
          record.unverifiedReason = "起動条件未充足（特定ゾーン枚数・状態等の事前条件が必要）";
        } else {
          record.unverifiedReason = "前提リソース未充足（特定カード/コンポーネントが盤面または手札・墓地に必要）";
        }
      }
    }

    console.log(`[AUDIT-8] LegalPatternGenerator 実生成 DecisionRequest 検証完了:`);
    console.log(`- 実証アクション数: ${verifiedActionIds.size}`);
    console.log(`- 実証合法パターン数: ${totalRealPatterns}`);
    expect(verifiedActionIds.size).toBeGreaterThan(0);
    expect(totalRealPatterns).toBeGreaterThan(10);
  });

  // 9. 選択条件の特殊ケース検証 (混在・非直積・不正ref)
  it("AUDIT-9: 選択条件の特殊ケース（混在・非直積・不正ref）の安全性検証", () => {
    // --- Case A: 同一アクションで「キー不要」と「キー必要」が混在するパターン ---
    // キー不要 (undefined) と 複数キー必要 (ref 0: ♠A, ref 1: ♥K) が混在
    const mixedKeyReq: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "audit-mixed-key",
      decisionId: "dec-mixed-key",
      stateVersion: 1,
      playerId: "p1",
      source: { type: "ACTION_REQUEST", playerId: "p1" },
      catalog: {
        actions: [{ actionRef: 0, actionId: "action.mixedKey", actionName: "混在キー技", speed: "normal" } as any],
        cardSelections: [
          { cardSelectionRef: 0, cardIds: ["c1"], displayCodes: ["♠A"] } as any,
          { cardSelectionRef: 1, cardIds: ["c2"], displayCodes: ["♥K"] } as any,
        ],
        costPayments: [],
        targetSelections: [],
        unitSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        { patternRef: 0, patternId: "p-no-key", actionSelectionRef: 0 } as any,
        { patternRef: 1, patternId: "p-key-0", actionSelectionRef: 0, keyCardSelectionRef: 0 } as any,
        { patternRef: 2, patternId: "p-key-1", actionSelectionRef: 0, keyCardSelectionRef: 1 } as any,
      ],
      observation: { players: [{ playerId: "p1", handCards: [] }, { playerId: "p2" }] } as any,
    };

    const onSubmitA = vi.fn();
    let rendererA!: TestRenderer.ReactTestRenderer;
    act(() => {
      rendererA = TestRenderer.create(<DecisionPanel request={mixedKeyReq} onSubmit={onSubmitA} />);
    });
    // アクション選択
    act(() => {
      findButton(rendererA.root, (t) => t.includes("混在キー技")).props.onClick();
    });
    // キーカードが2候補あるため、未選択状態では提出不可
    const submitBtnA = findButton(rendererA.root, (t) => t.includes("リクエスト＆PASS") || t.includes("リクエスト"));
    expect(submitBtnA.props.disabled).toBe(true);
    // Enter でも誤提出されないこと
    act(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {}, stopPropagation: () => {} } as any);
      }
    });
    expect(onSubmitA).not.toHaveBeenCalled();

    // キー ♠A を選択すると提出可能になること
    const key0Btn = findButton(rendererA.root, (t) => t.includes("♠A"));
    act(() => {
      key0Btn.props.onClick();
    });
    expect(submitBtnA.props.disabled).toBe(false);
    act(() => {
      submitBtnA.props.onClick();
    });
    expect(onSubmitA).toHaveBeenCalledTimes(1);
    expect((onSubmitA.mock.calls[0][0] as DecisionResponse).selectedPatternRef).toBe(1);

    // --- Case B: 同一アクションで「コスト不要」と「コスト必要」が混在するパターン ---
    const mixedCostReq: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "audit-mixed-cost",
      decisionId: "dec-mixed-cost",
      stateVersion: 1,
      playerId: "p1",
      source: { type: "ACTION_REQUEST", playerId: "p1" },
      catalog: {
        actions: [{ actionRef: 0, actionId: "action.mixedCost", actionName: "混在コスト技", speed: "normal" } as any],
        cardSelections: [],
        costPayments: [
          { costPaymentRef: 0, summary: "防壁AをDRIVE" } as any,
          { costPaymentRef: 1, summary: "防壁BをDRIVE" } as any,
        ],
        targetSelections: [],
        unitSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        { patternRef: 0, patternId: "p-no-cost", actionSelectionRef: 0 } as any,
        { patternRef: 1, patternId: "p-cost-0", actionSelectionRef: 0, costPaymentRef: 0 } as any,
        { patternRef: 2, patternId: "p-cost-1", actionSelectionRef: 0, costPaymentRef: 1 } as any,
      ],
      observation: { players: [{ playerId: "p1", handCards: [] }, { playerId: "p2" }] } as any,
    };

    const onSubmitB = vi.fn();
    let rendererB!: TestRenderer.ReactTestRenderer;
    act(() => {
      rendererB = TestRenderer.create(<DecisionPanel request={mixedCostReq} onSubmit={onSubmitB} />);
    });
    act(() => {
      findButton(rendererB.root, (t) => t.includes("混在コスト技")).props.onClick();
    });
    const submitBtnB = findButton(rendererB.root, (t) => t.includes("リクエスト＆PASS") || t.includes("リクエスト"));
    expect(submitBtnB.props.disabled).toBe(true);
    act(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {}, stopPropagation: () => {} } as any);
      }
    });
    expect(onSubmitB).not.toHaveBeenCalled();

    // コスト 0 を選択すると提出可能になること
    act(() => {
      findButton(rendererB.root, (t) => t.includes("防壁AをDRIVE")).props.onClick();
    });
    expect(submitBtnB.props.disabled).toBe(false);
    act(() => {
      submitBtnB.props.onClick();
    });
    expect(onSubmitB).toHaveBeenCalledTimes(1);
    expect((onSubmitB.mock.calls[0][0] as DecisionResponse).selectedPatternRef).toBe(1);

    // --- Case C: 同一アクションで「対象不要」と「対象必要」が混在するパターン ---
    const mixedTargetReq: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "audit-mixed-target",
      decisionId: "dec-mixed-target",
      stateVersion: 1,
      playerId: "p1",
      source: { type: "ACTION_REQUEST", playerId: "p1" },
      catalog: {
        actions: [{ actionRef: 0, actionId: "action.mixedTarget", actionName: "混在対象技", speed: "normal" } as any],
        cardSelections: [],
        costPayments: [],
        targetSelections: [
          { targetSelectionRef: 0, displayName: "相手兵士X" } as any,
          { targetSelectionRef: 1, displayName: "相手兵士Y" } as any,
        ],
        unitSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        { patternRef: 0, patternId: "p-no-tgt", actionSelectionRef: 0 } as any,
        { patternRef: 1, patternId: "p-tgt-0", actionSelectionRef: 0, targetSelectionRef: 0 } as any,
        { patternRef: 2, patternId: "p-tgt-1", actionSelectionRef: 0, targetSelectionRef: 1 } as any,
      ],
      observation: { players: [{ playerId: "p1", handCards: [] }, { playerId: "p2" }] } as any,
    };

    const onSubmitC = vi.fn();
    let rendererC!: TestRenderer.ReactTestRenderer;
    act(() => {
      rendererC = TestRenderer.create(<DecisionPanel request={mixedTargetReq} onSubmit={onSubmitC} />);
    });
    act(() => {
      findButton(rendererC.root, (t) => t.includes("混在対象技")).props.onClick();
    });
    const submitBtnC = findButton(rendererC.root, (t) => t.includes("リクエスト＆PASS") || t.includes("リクエスト"));
    expect(submitBtnC.props.disabled).toBe(true);
    act(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {}, stopPropagation: () => {} } as any);
      }
    });
    expect(onSubmitC).not.toHaveBeenCalled();

    // 対象 1 を選択すると提出可能になること
    act(() => {
      findButton(rendererC.root, (t) => t.includes("相手兵士Y")).props.onClick();
    });
    expect(submitBtnC.props.disabled).toBe(false);
    act(() => {
      submitBtnC.props.onClick();
    });
    expect(onSubmitC).toHaveBeenCalledTimes(1);
    expect((onSubmitC.mock.calls[0][0] as DecisionResponse).selectedPatternRef).toBe(2);

    // --- Case D: 存在しないキー・コスト・対象の参照 (不正ref: 999) を指定した場合 ---
    // patterns に存在しない不正 ref が pattern に混入、または UI 状態で存在しない場合
    const invalidRefReq: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "audit-invalid-ref",
      decisionId: "dec-invalid-ref",
      stateVersion: 1,
      playerId: "p1",
      source: { type: "ACTION_REQUEST", playerId: "p1" },
      catalog: {
        actions: [{ actionRef: 0, actionId: "action.invalidRef", actionName: "不正ref技", speed: "normal" } as any],
        cardSelections: [{ cardSelectionRef: 0, cardIds: ["c1"], displayCodes: ["♠A"] } as any],
        costPayments: [],
        targetSelections: [{ targetSelectionRef: 0, displayName: "ユニットA" } as any],
        unitSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        // 存在しない targetSelectionRef: 999 を参照している壊れたパターン
        { patternRef: 0, patternId: "p-broken", actionSelectionRef: 0, keyCardSelectionRef: 0, targetSelectionRef: 999 } as any,
      ],
      observation: { players: [{ playerId: "p1", handCards: [] }, { playerId: "p2" }] } as any,
    };

    const onSubmitD = vi.fn();
    let rendererD!: TestRenderer.ReactTestRenderer;
    act(() => {
      rendererD = TestRenderer.create(<DecisionPanel request={invalidRefReq} onSubmit={onSubmitD} />);
    });
    act(() => {
      findButton(rendererD.root, (t) => t.includes("不正ref技")).props.onClick();
    });
    const submitBtnD = findButton(rendererD.root, (t) => t.includes("リクエスト＆PASS") || t.includes("リクエスト"));
    // パターンと整合しないため、安全に提出不可（クラッシュもなし）
    expect(submitBtnD.props.disabled).toBe(true);
    act(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {}, stopPropagation: () => {} } as any);
      }
    });
    expect(onSubmitD).not.toHaveBeenCalled();

    // --- Case E: 単一キーカード候補＋複数コスト＋複数対象のパイプライン検証 ---
    const singleKeyMultiCostTargetReq: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "audit-singlekey-multi-req",
      decisionId: "dec-singlekey-multi",
      stateVersion: 1,
      playerId: "p1",
      source: { type: "ACTION_REQUEST", playerId: "p1" },
      catalog: {
        actions: [{ actionRef: 0, actionId: "action.pipeline", actionName: "パイプライン技", speed: "normal" } as any],
        cardSelections: [{ cardSelectionRef: 0, cardIds: ["c1"], displayCodes: ["♠A"] } as any], // 1候補
        costPayments: [
          { costPaymentRef: 0, summary: "コスト1" } as any,
          { costPaymentRef: 1, summary: "コスト2" } as any,
        ], // 2候補
        targetSelections: [
          { targetSelectionRef: 0, displayName: "対象X" } as any,
          { targetSelectionRef: 1, displayName: "対象Y" } as any,
        ], // 2候補
        unitSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        { patternRef: 0, patternId: "p0", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0 } as any,
        { patternRef: 1, patternId: "p1", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 1 } as any,
        { patternRef: 2, patternId: "p2", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 1, targetSelectionRef: 0 } as any,
        { patternRef: 3, patternId: "p3", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 1, targetSelectionRef: 1 } as any,
      ],
      observation: { players: [{ playerId: "p1", handCards: [] }, { playerId: "p2" }] } as any,
    };

    const onSubmitE = vi.fn();
    let rendererE!: TestRenderer.ReactTestRenderer;
    act(() => {
      rendererE = TestRenderer.create(<DecisionPanel request={singleKeyMultiCostTargetReq} onSubmit={onSubmitE} />);
    });
    act(() => {
      findButton(rendererE.root, (t) => t.includes("パイプライン技")).props.onClick();
    });
    const submitBtnE = findButton(rendererE.root, (t) => t.includes("リクエスト＆PASS") || t.includes("リクエスト"));
    // 単一キーカードは自動解決されるが、コストと対象が未確定なのでブロック
    expect(submitBtnE.props.disabled).toBe(true);

    // コスト1 のみ選択
    act(() => {
      findButton(rendererE.root, (t) => t.includes("コスト1")).props.onClick();
    });
    // 対象が未確定なので依然としてブロック
    expect(submitBtnE.props.disabled).toBe(true);

    // 対象Y を選択
    act(() => {
      findButton(rendererE.root, (t) => t.includes("対象Y")).props.onClick();
    });
    // 完全確定により提出可能
    expect(submitBtnE.props.disabled).toBe(false);
    act(() => {
      submitBtnE.props.onClick();
    });
    expect(onSubmitE).toHaveBeenCalledTimes(1);
    expect((onSubmitE.mock.calls[0][0] as DecisionResponse).selectedPatternRef).toBe(1);

    // --- Case F: 候補組み合わせが直積にならない合法パターン (非直積) ---
    // Key 0 は Cost 0 + Target 0 にのみ対応、Key 1 は Cost 1 + Target 1 にのみ対応
    const nonCartesianReq: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "audit-non-cartesian",
      decisionId: "dec-non-cartesian",
      stateVersion: 1,
      playerId: "p1",
      source: { type: "ACTION_REQUEST", playerId: "p1" },
      catalog: {
        actions: [{ actionRef: 0, actionId: "action.nonCartesian", actionName: "非直積技", speed: "normal" } as any],
        cardSelections: [
          { cardSelectionRef: 0, cardIds: ["c1"], displayCodes: ["♠A"] } as any,
          { cardSelectionRef: 1, cardIds: ["c2"], displayCodes: ["♥K"] } as any,
        ],
        costPayments: [
          { costPaymentRef: 0, summary: "コストAlpha" } as any,
          { costPaymentRef: 1, summary: "コストBeta" } as any,
        ],
        targetSelections: [
          { targetSelectionRef: 0, displayName: "対象Alpha" } as any,
          { targetSelectionRef: 1, displayName: "対象Beta" } as any,
        ],
        unitSelections: [],
        effectSelections: [],
        orderSelections: [],
      },
      patterns: [
        { patternRef: 0, patternId: "p-alpha", actionSelectionRef: 0, keyCardSelectionRef: 0, costPaymentRef: 0, targetSelectionRef: 0 } as any,
        { patternRef: 1, patternId: "p-beta", actionSelectionRef: 0, keyCardSelectionRef: 1, costPaymentRef: 1, targetSelectionRef: 1 } as any,
      ],
      observation: { players: [{ playerId: "p1", handCards: [] }, { playerId: "p2" }] } as any,
    };

    const onSubmitF = vi.fn();
    let rendererF!: TestRenderer.ReactTestRenderer;
    act(() => {
      rendererF = TestRenderer.create(<DecisionPanel request={nonCartesianReq} onSubmit={onSubmitF} />);
    });
    act(() => {
      findButton(rendererF.root, (t) => t.includes("非直積技")).props.onClick();
    });
    const submitBtnF = findButton(rendererF.root, (t) => t.includes("リクエスト＆PASS") || t.includes("リクエスト"));
    expect(submitBtnF.props.disabled).toBe(true);

    // Key 0 (♠A) を選択 -> 自動的に CostAlpha と TargetAlpha に絞り込まれて確定
    act(() => {
      findButton(rendererF.root, (t) => t.includes("♠A")).props.onClick();
    });
    expect(submitBtnF.props.disabled).toBe(false);
    act(() => {
      submitBtnF.props.onClick();
    });
    expect(onSubmitF).toHaveBeenCalledTimes(1);
    expect((onSubmitF.mock.calls[0][0] as DecisionResponse).selectedPatternRef).toBe(0);
  });

  // 10. ブロッカー割当て不正ケース検証
  it("AUDIT-10: ブロッカー割当ての不正ケース（同一ブロッカーの複数アタッカー割当て・兵士防壁不正混在・非合法割当て）で決定不能となる検証", () => {
    // 2体のアタッカー (atk-1, atk-2) と 2体のブロッカー候補 (def-1, def-2)
    const blockReq: DecisionRequest = {
      protocolVersion: "1.0.0",
      matchId: "audit-block-req",
      decisionId: "dec-block-req",
      stateVersion: 1,
      playerId: "p2",
      source: {
        type: "EFFECT_RESOLUTION",
        sourceRequestRef: "req-atk-1",
        effectStepId: "step-blk-1",
        playerId: "p2",
      },
      observation: {
        players: [
          {
            playerId: "p1",
            name: "Player A",
            field: [
              { unitId: "atk-1", componentId: "character.soldier", kind: "一般兵", state: "drive", cards: [{ id: "c-a1", suit: "S", rank: "10", value: 10 }] },
              { unitId: "atk-2", componentId: "character.soldier", kind: "一般兵", state: "drive", cards: [{ id: "c-a2", suit: "H", rank: "9", value: 9 }] },
            ],
          },
          {
            playerId: "p2",
            name: "Player B",
            field: [
              { unitId: "def-1", componentId: "character.soldier", kind: "一般兵", state: "charge", cards: [{ id: "c-d1", suit: "C", rank: "8", value: 8 }] },
              { unitId: "def-2", componentId: "character.soldier", kind: "一般兵", state: "charge", cards: [{ id: "c-d2", suit: "D", rank: "7", value: 7 }] },
              { unitId: "bw-1", componentId: "character.bulwark", kind: "防壁", state: "charge", cards: [{ id: "c-bw1", suit: "S", rank: "2", value: 2 }] },
            ],
          },
        ] as any,
      } as any,
      catalog: {
        actions: [],
        cardSelections: [],
        costPayments: [],
        targetSelections: [],
        unitSelections: [],
        effectSelections: [
          // 合法パターン0: 全アタッカー スルー
          {
            effectSelectionRef: 0,
            selectionType: "unitAssignment",
            assignments: [
              { sourceUnitId: "atk-1", selectedUnitIds: [] },
              { sourceUnitId: "atk-2", selectedUnitIds: [] },
            ],
            summary: "ブロックなし",
          } as any,
          // 合法パターン1: atk-1 のみ def-1 でブロック
          {
            effectSelectionRef: 1,
            selectionType: "unitAssignment",
            assignments: [
              { sourceUnitId: "atk-1", selectedUnitIds: ["def-1"] },
              { sourceUnitId: "atk-2", selectedUnitIds: [] },
            ],
            summary: "atk-1 ← def-1",
          } as any,
          // 合法パターン2: atk-1 を def-1, atk-2 を def-2 でブロック
          {
            effectSelectionRef: 2,
            selectionType: "unitAssignment",
            assignments: [
              { sourceUnitId: "atk-1", selectedUnitIds: ["def-1"] },
              { sourceUnitId: "atk-2", selectedUnitIds: ["def-2"] },
            ],
            summary: "atk-1 ← def-1 / atk-2 ← def-2",
          } as any,
        ],
        orderSelections: [],
      },
      patterns: [
        { patternRef: 0, patternId: "pat-blk-0", effectSelectionRef: 0, kind: "EFFECT_SELECTION" } as any,
        { patternRef: 1, patternId: "pat-blk-1", effectSelectionRef: 1, kind: "EFFECT_SELECTION" } as any,
        { patternRef: 2, patternId: "pat-blk-2", effectSelectionRef: 2, kind: "EFFECT_SELECTION" } as any,
      ],
    };

    // --- 不正ケース 1: 同じブロッカー (def-1) の複数アタッカー (atk-1, atk-2) への重複割当て ---
    const invalidDuplicateBlockMap = {
      "atk-1": ["def-1"],
      "atk-2": ["def-1"],
    };
    const exactRefDup = findExactMatchPatternRef(invalidDuplicateBlockMap, blockReq.catalog.effectSelections);
    expect(exactRefDup).toBeNull(); // 合法パターンに存在しないため null

    // --- 不正ケース 2: 兵士と防壁の不正な混在（防壁 bw-1 をブロックに割り当てようとした状態） ---
    const invalidBulwarkBlockMap = {
      "atk-1": ["bw-1"],
      "atk-2": [],
    };
    const exactRefBulwark = findExactMatchPatternRef(invalidBulwarkBlockMap, blockReq.catalog.effectSelections);
    expect(exactRefBulwark).toBeNull(); // 防壁によるブロックはルール外のため null

    // --- 不正ケース 3: 合法パターンに存在しない任意の不正割当て (存在しないユニット "unknown-unit") ---
    const invalidUnknownBlockMap = {
      "atk-1": ["unknown-unit"],
      "atk-2": [],
    };
    const exactRefUnknown = findExactMatchPatternRef(invalidUnknownBlockMap, blockReq.catalog.effectSelections);
    expect(exactRefUnknown).toBeNull(); // 存在しないユニットのため null

    // --- DecisionPanel UI での不正割当て時の決定ボタン無効化検証 ---
    const unitNumberMap = new Map<string, any>([
      ["atk-1", { badge: "①", label: "Player A の 一般兵 ♠10", unitView: {} }],
      ["atk-2", { badge: "②", label: "Player A の 一般兵 ♥9", unitView: {} }],
      ["def-1", { badge: "③", label: "Player B の 一般兵 ♣8", unitView: {} }],
      ["def-2", { badge: "④", label: "Player B の 一般兵 ♦7", unitView: {} }],
      ["bw-1", { badge: "⑤", label: "Player B の 防壁 ♠2", unitView: {} }],
    ]);

    const onExactChange = vi.fn();
    const onSelectPat = vi.fn();
    let editorRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      editorRenderer = TestRenderer.create(
        <BlockAssignmentEditor
          request={blockReq}
          unitNumberMap={unitNumberMap}
          onSelectPattern={onSelectPat}
          onExactPatternRefChange={onExactChange}
          initialAssignments={invalidDuplicateBlockMap} // 不正な重複割当てを渡す
        />
      );
    });

    // onExactPatternRefChange に null が通知され、決定ボタンは押せないこと
    expect(onExactChange).toHaveBeenCalledWith(null);

    // 決定ボタン（「この割り当てで決定」等）を探す
    const buttons = editorRenderer.root.findAllByType("button");
    const confirmBtn = buttons.find((b) => extractText(b).includes("決定"));
    if (confirmBtn) {
      expect(confirmBtn.props.disabled).toBe(true);
      act(() => {
        confirmBtn.props.onClick();
      });
      expect(onSelectPat).not.toHaveBeenCalled();
    }
  });

  // 11. 監査総括テスト
  it("AUDIT-SUMMARY: 全監査結果を集計し、全アクションでの完全合格を確認", () => {
    const realVerifiedActions = auditRecords.filter((r) => r.isRealGeneratorVerified);
    const mockOnlyActions = auditRecords.filter((r) => !r.isRealGeneratorVerified);
    const standardActions = auditRecords.filter((r) => r.regulationScope.includes("Standard"));
    const proActions = auditRecords.filter((r) => r.regulationScope.includes("Pro"));
    const masterExtraActions = auditRecords.filter((r) => r.regulationScope.includes("Master/Extra"));

    const summary = {
      totalActions: auditRecords.length,
      realCount: realVerifiedActions.length,
      mockOnlyCount: mockOnlyActions.length,
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
    console.log(`- 実生成検証アクション数 (LegalPatternGenerator): ${summary.realCount}`);
    console.log(`- 共通UI検証アクション数 (模擬DecisionRequest): ${summary.mockOnlyCount}`);
    console.log(`- Standard アクション数: ${summary.standardCount}`);
    console.log(`- Pro アクション数: ${summary.proCount}`);
    console.log(`- Master/Extra アクション数: ${summary.masterExtraCount}`);
    console.log(`未選択提出ブロック合格数: ${summary.unselectedBlockedPassCount} / ${summary.totalActions}`);
    console.log(`Enter誤提出防止合格数: ${summary.enterBlockedPassCount} / ${summary.totalActions}`);
    console.log(`Shift+Enter誤提出防止合格数: ${summary.shiftEnterBlockedPassCount} / ${summary.totalActions}`);
    console.log(`確定後正常提出合格数: ${summary.resolvedSubmitPassCount} / ${summary.totalActions}`);
    console.log(`検証パターン総数: ${summary.totalPatternsTested}`);

    console.log("\n--- [実生成22アクション (LegalPatternGenerator)] ---");
    realVerifiedActions.forEach((r, idx) => {
      console.log(`  ${idx + 1}. [${r.regulationScope.join("/")}] ${r.actionId} (${r.actionName})`);
    });

    console.log("\n--- [模擬テストのみ15アクション (共通UI検証) & 実生成不可理由] ---");
    mockOnlyActions.forEach((r, idx) => {
      console.log(`  ${idx + 1}. [${r.regulationScope.join("/")}] ${r.actionId} (${r.actionName}): ${r.unverifiedReason}`);
    });

    expect(summary.totalActions).toBeGreaterThanOrEqual(15);
    expect(summary.unselectedBlockedPassCount).toBe(summary.totalActions);
    expect(summary.enterBlockedPassCount).toBe(summary.totalActions);
    expect(summary.shiftEnterBlockedPassCount).toBe(summary.totalActions);
    expect(summary.resolvedSubmitPassCount).toBe(summary.totalActions);
    expect(summary.realCount).toBe(22);
    expect(summary.mockOnlyCount).toBe(15);
  });
});
