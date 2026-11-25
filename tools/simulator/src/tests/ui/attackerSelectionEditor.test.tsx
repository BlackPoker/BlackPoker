import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AttackerSelectionEditor,
  buildUnitSetSelectionModel,
} from "../../ui/decision/AttackerSelectionEditor";
import { DecisionRequest } from "../../domain/decision/DecisionRequest";
import { LegalPattern } from "../../domain/decision/LegalPattern";
import { EffectSelection } from "../../domain/decision/DecisionCatalog";

function createAttackSelectionRequest(
  unitIds: string[],
  decisionId: string = "dec-atk-1"
): DecisionRequest {
  const effectSelections: EffectSelection[] = [];
  const patterns: LegalPattern[] = [];
  const total = 1 << unitIds.length;

  for (let mask = 0; mask < total; mask++) {
    const selected: string[] = [];
    for (let i = 0; i < unitIds.length; i++) {
      if (mask & (1 << i)) {
        selected.push(unitIds[i]);
      }
    }
    const idx = effectSelections.length;
    effectSelections.push({
      selectionType: "unit",
      selectedValues: selected,
    });
    patterns.push({
      patternId: `pat-${idx}`,
      kind: "EFFECT_SELECTION",
      effectSelectionRef: idx,
    });
  }

  return {
    protocolVersion: "1.0",
    matchId: "atk-ui-test",
    decisionId,
    stateVersion: 10,
    playerId: "p1",
    source: {
      type: "EFFECT_RESOLUTION",
      sourceRequestRef: "req-1",
      effectStepId: "selectUnits",
      sourceActionId: "action.attack",
    },
    patterns,
    catalog: {
      actions: [],
      cardSelections: [],
      costPayments: [],
      effectSelections,
      unitSelections: [],
      targetSelections: [],
      orderSelections: [],
    },
    observation: { players: [] } as any,
  };
}

describe("AttackerSelectionEditor (作業B)", () => {
  const unitIds = ["u1", "u2", "u3", "u4"];
  const unitNumberMap = new Map(
    unitIds.map((id, i) => [
      id,
      { badge: `兵${i + 1}`, label: `兵士${i + 1}`, unitView: { unitId: id } },
    ])
  );

  it("4体(16通り)の合法パターンを兵士単位に集約し、全選択・全解除・空集合・個別集合が正確なpatternRefに一致すること", () => {
    const req = createAttackSelectionRequest(unitIds);
    const model = buildUnitSetSelectionModel(req);
    expect(model.isUnitSetSelection).toBe(true);
    expect(model.candidateUnitIds).toEqual(unitIds);
    expect(model.patternMap.size).toBe(16);

    // 空集合 -> ref 0
    expect(model.patternMap.get("")).toBe(0);
    // u1 + u3 -> mask 5
    expect(model.patternMap.get(["u1", "u3"].sort().join(","))).toBe(5);
    // 全選択 -> mask 15
    expect(model.patternMap.get([...unitIds].sort().join(","))).toBe(15);

    const html = renderToStaticMarkup(
      <AttackerSelectionEditor
        key={req.decisionId}
        request={req}
        unitNumberMap={unitNumberMap}
        onExactPatternRefChange={() => {}}
      />
    );
    expect(html).toContain("attacker-selection-editor");
    expect(html).toContain("全選択");
    expect(html).toContain("全解除");
    expect(html).toContain("attacker-unit-btn-u1");
    expect(html).toContain("attacker-unit-btn-u4");
  });

  it("action.attack 以外の EFFECT_RESOLUTION には適用されないこと", () => {
    const req = createAttackSelectionRequest(unitIds);
    const nonAttackReq: DecisionRequest = {
      ...req,
      source: {
        type: "EFFECT_RESOLUTION",
        sourceRequestRef: "req-2",
        effectStepId: "selectUnits",
        sourceActionId: "action.reverse",
      },
    };
    expect(buildUnitSetSelectionModel(nonAttackReq).isUnitSetSelection).toBe(false);
  });
});
