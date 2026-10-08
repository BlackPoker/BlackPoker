import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import { DecisionPanel } from "../../ui/decision/DecisionPanel";
import { UnitCard } from "../../ui/game/UnitCard";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";

/**
 * テストレンダラー内のテキスト抽出ヘルパー
 */
function extractText(instance: TestRenderer.ReactTestInstance): string {
  if (typeof instance.children === "string") return instance.children;
  if (!Array.isArray(instance.children)) return "";
  return instance.children
    .map((c) => (typeof c === "string" ? c : typeof c === "object" ? extractText(c) : ""))
    .join("");
}

function findButtons(root: TestRenderer.ReactTestInstance): TestRenderer.ReactTestInstance[] {
  return root.findAllByType("button");
}

describe("Effect Selection Label Identification & Disambiguation [BP-SIM-UI-REVERSE-EFFECT-LABEL-R1]", () => {
  // 共通の疑似盤面モック（Player B の一般兵 2体）
  const createMockUnit = (unitId: string, suit: string, rank: number, isFaceDown = false, isHidden = false) => ({
    unitId,
    kind: "一般兵",
    componentId: "character.soldier",
    face: isFaceDown ? "down" : "up",
    state: "charge",
    cards: [
      {
        cardInstanceId: `c-${unitId}`,
        code: `${suit.toUpperCase()}${rank}`,
        suit,
        rank,
        visibility: isHidden ? "HIDDEN" : "VISIBLE",
      },
    ],
  });

  const baseReverseDecisionRequest: DecisionRequest = {
    protocolVersion: "1.0",
    matchId: "match-test",
    decisionId: "dec-reverse-1",
    stateVersion: 1,
    playerId: "p1",
    source: {
      type: "EFFECT_RESOLUTION",
      sourceRequestRef: "req-reverse-1",
      effectStepId: "step-1",
      playerId: "p1",
    },
    catalog: {
      actions: [],
      cardSelections: [],
      costPayments: [],
      targetSelections: [],
      effectSelections: [
        {
          effectSelectionRef: 0,
          selectionType: "target",
          selectedValues: ["u-b1"],
        } as any,
        {
          effectSelectionRef: 1,
          selectionType: "target",
          selectedValues: ["u-b2"],
        } as any,
      ],
    } as any,
    patterns: [
      {
        patternRef: 0,
        patternId: "pat-eff-0",
        effectSelectionRef: 0,
        kind: "EFFECT_SELECTION",
      } as any,
      {
        patternRef: 1,
        patternId: "pat-eff-1",
        effectSelectionRef: 1,
        kind: "EFFECT_SELECTION",
      } as any,
    ],
    observation: {
      players: [
        {
          playerId: "p1",
          name: "Player A",
          field: [],
        },
        {
          playerId: "p2",
          name: "Player B",
          field: [
            createMockUnit("u-b1", "c", 3), // Player B の一般兵 ♣3
            createMockUnit("u-b2", "h", 9), // Player B の一般兵 ♡9
          ],
        },
      ],
    } as any,
  };

  it("Test A: Duplicate Label Collision - 候補ラベルが同一になる場合、自動的に [1], [2] を付与して衝突を完全解消する", () => {
    // 同一カード・同一プレイヤー・同一種別の極端なケース
    const collisionRequest: DecisionRequest = {
      ...baseReverseDecisionRequest,
      observation: {
        players: [
          { playerId: "p1", name: "Player A", field: [] },
          {
            playerId: "p2",
            name: "Player B",
            // 2体とも同一情報を持つ同一ラベル候補
            field: [
              { unitId: "u-dup1", kind: "一般兵", componentId: "character.soldier", cards: [] },
              { unitId: "u-dup2", kind: "一般兵", componentId: "character.soldier", cards: [] },
            ],
          },
        ],
      } as any,
      catalog: {
        ...baseReverseDecisionRequest.catalog,
        effectSelections: [
          { effectSelectionRef: 0, selectedValues: ["u-dup1"] } as any,
          { effectSelectionRef: 1, selectedValues: ["u-dup2"] } as any,
        ],
      } as any,
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel request={collisionRequest} onSubmit={vi.fn()} />
      );
    });

    const buttons = findButtons(renderer.root);
    const candidateTexts = buttons.map((b) => extractText(b)).filter((t) => t.includes("一般兵"));

    // 2つのボタンが存在し、かつラベル文字列が完全に不一致（重複解消）していること
    expect(candidateTexts.length).toBe(2);
    expect(candidateTexts[0]).not.toBe(candidateTexts[1]);
    expect(candidateTexts[0]).toContain("①");
    expect(candidateTexts[1]).toContain("②");
  });

  it("Test B: Reverse-like Case - 同一プレイヤーの一般兵2体候補で、UI表示ラベルが明確に区別可能であること", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel request={baseReverseDecisionRequest} onSubmit={vi.fn()} />
      );
    });

    const buttons = findButtons(renderer.root);
    const candidateTexts = buttons.map((b) => extractText(b)).filter((t) => t.includes("一般兵"));

    expect(candidateTexts.length).toBe(2);
    // 第一候補: ① Player B の一般兵（♣3）
    expect(candidateTexts[0]).toContain("①");
    expect(candidateTexts[0]).toContain("Player B の一般兵");
    expect(candidateTexts[0]).toContain("♣3");

    // 第二候補: ② Player B の一般兵（♥9 または ♡9）
    expect(candidateTexts[1]).toContain("②");
    expect(candidateTexts[1]).toContain("Player B の一般兵");
    expect(candidateTexts[1]).toMatch(/[♥♡]9/);

    // 2つの候補が完全に異なる文字列であること
    expect(candidateTexts[0]).not.toEqual(candidateTexts[1]);
  });

  it("Test C: UI Rendering - 見出しが『Player A の対象ユニットを選択』、補助文言が『対象ユニットを選択...』としてrenderされること", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel request={baseReverseDecisionRequest} onSubmit={vi.fn()} />
      );
    });

    const rootText = extractText(renderer.root);

    // 見出しの検証
    expect(rootText).toContain("Player A の対象ユニットを選択");
    // 補助文言の検証
    expect(rootText).toContain("対象ユニットを選択（盤面をタップまたは下記から選択）:");
  });

  it("Test D: Board/List Linkage - 盤面マーカー（①, ②）とリストの番号が一致し、選択状態が反映されること", () => {
    let capturedMarkers: Map<string, { badge: string; isSelected: boolean }> | undefined;
    const onSelectionMarkersChange = (markers: Map<string, { badge: string; isSelected: boolean }>) => {
      capturedMarkers = markers;
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel
          request={baseReverseDecisionRequest}
          onSubmit={vi.fn()}
          onSelectionMarkersChange={onSelectionMarkersChange}
        />
      );
    });

    expect(capturedMarkers).toBeDefined();
    expect(capturedMarkers!.size).toBe(2);

    const marker1 = capturedMarkers!.get("u-b1");
    const marker2 = capturedMarkers!.get("u-b2");

    expect(marker1).toBeDefined();
    expect(marker2).toBeDefined();
    expect(marker1!.badge).toBe("①");
    expect(marker2!.badge).toBe("②");

    // UnitCard に渡されたときのレンダリング確認
    const unit1 = baseReverseDecisionRequest.observation.players[1].field[0];
    let cardRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      cardRenderer = TestRenderer.create(
        <UnitCard unit={unit1} selectionMarker={{ badge: marker1!.badge, isSelected: false }} />
      );
    });

    const unselectedCardText = extractText(cardRenderer.root);
    expect(unselectedCardText).toContain("①");
    expect(unselectedCardText).not.toContain("①✓");

    // 選択状態に更新した場合
    act(() => {
      cardRenderer.update(
        <UnitCard unit={unit1} selectionMarker={{ badge: marker1!.badge, isSelected: true }} />
      );
    });
    const selectedCardText = extractText(cardRenderer.root);
    expect(selectedCardText).toContain("①✓");
  });

  it("Test E: 「 のみ」サフィックスの完全排除 - 単一ユニット選択でも『 のみ』が付与されないこと", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel request={baseReverseDecisionRequest} onSubmit={vi.fn()} />
      );
    });

    const rootText = extractText(renderer.root);
    expect(rootText).not.toContain("のみ");
  });

  it("Test F: Fail-Closed 秘匿情報保護 - 相手の伏せカードの情報が候補ラベルに漏洩しないこと", () => {
    const hiddenCardRequest: DecisionRequest = {
      ...baseReverseDecisionRequest,
      observation: {
        players: [
          { playerId: "p1", name: "Player A", field: [] },
          {
            playerId: "p2",
            name: "Player B",
            field: [
              // 伏せカードの一般兵 (相手視点)
              createMockUnit("u-b1", "c", 3, true, true),
              createMockUnit("u-b2", "h", 9, false, false),
            ],
          },
        ],
      } as any,
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DecisionPanel request={hiddenCardRequest} onSubmit={vi.fn()} />
      );
    });

    const buttons = findButtons(renderer.root);
    const candidateTexts = buttons.map((b) => extractText(b)).filter((t) => t.includes("一般兵"));

    // 伏せカードのユニット u-b1 は ♣3 が漏洩せず、番号とユニット種別のみで区別される
    expect(candidateTexts[0]).toContain("①");
    expect(candidateTexts[0]).toContain("Player B の一般兵");
    expect(candidateTexts[0]).not.toContain("♣3");

    // 表向きの u-b2 はカード情報を含む
    expect(candidateTexts[1]).toContain("②");
    expect(candidateTexts[1]).toContain("Player B の一般兵");
    expect(candidateTexts[1]).toMatch(/[♥♡]9/);
  });
});
