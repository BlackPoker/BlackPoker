import { describe, it, expect } from "vitest";
import {
  findMatchingEffectSelectionIndices,
  canAssignBlocker,
  findExactMatchPatternRef,
  AttackerBlockMap,
} from "../../ui/decision/blockAssignmentUtils";
import { EffectSelection } from "../../domain/decision/DecisionCatalog";

describe("Block Assignment UI Logic Tests (Phase 21B.5)", () => {
  // モックの Legal Patterns (1 Attacker 'atk-1', Candidates: 's1', 's2', 'bw')
  // 合法パターン: [] (0), [s1] (1), [s2] (2), [s1, s2] (3), [bw] (4)
  const effectSelections: EffectSelection[] = [
    {
      selectionType: "unitAssignment",
      assignments: [{ sourceUnitId: "atk-1", selectedUnitIds: [] }],
      summary: "atk-1 -> [ブロックなし]",
    },
    {
      selectionType: "unitAssignment",
      assignments: [{ sourceUnitId: "atk-1", selectedUnitIds: ["s1"] }],
      summary: "atk-1 -> [s1]",
    },
    {
      selectionType: "unitAssignment",
      assignments: [{ sourceUnitId: "atk-1", selectedUnitIds: ["s2"] }],
      summary: "atk-1 -> [s2]",
    },
    {
      selectionType: "unitAssignment",
      assignments: [{ sourceUnitId: "atk-1", selectedUnitIds: ["s1", "s2"] }],
      summary: "atk-1 -> [s1, s2]",
    },
    {
      selectionType: "unitAssignment",
      assignments: [{ sourceUnitId: "atk-1", selectedUnitIds: ["bw"] }],
      summary: "atk-1 -> [bw]",
    },
  ];

  it("should match all patterns when initial state is empty", () => {
    const currentMap: AttackerBlockMap = { "atk-1": [] };
    const matches = findMatchingEffectSelectionIndices(currentMap, effectSelections);
    expect(matches.length).toBe(5);

    const exactRef = findExactMatchPatternRef(currentMap, effectSelections);
    expect(exactRef).toBe(0); // [ブロックなし]
  });

  it("should filter candidates when s1 is assigned", () => {
    const currentMap: AttackerBlockMap = { "atk-1": ["s1"] };
    const matches = findMatchingEffectSelectionIndices(currentMap, effectSelections);
    // 一致し得るのは [s1] (1) と [s1, s2] (3)
    expect(matches).toEqual([1, 3]);

    const exactRef = findExactMatchPatternRef(currentMap, effectSelections);
    expect(exactRef).toBe(1);

    // s2 の追加は可能 (canAssignBlocker === true)
    expect(canAssignBlocker(currentMap, "atk-1", "s2", effectSelections)).toBe(true);

    // bw の追加は不可 (canAssignBlocker === false) -> UI で disabled
    expect(canAssignBlocker(currentMap, "atk-1", "bw", effectSelections)).toBe(false);
  });

  it("should disable s1 and s2 when bw is assigned", () => {
    const currentMap: AttackerBlockMap = { "atk-1": ["bw"] };
    const matches = findMatchingEffectSelectionIndices(currentMap, effectSelections);
    expect(matches).toEqual([4]);

    const exactRef = findExactMatchPatternRef(currentMap, effectSelections);
    expect(exactRef).toBe(4);

    // s1, s2 の追加は共に不可
    expect(canAssignBlocker(currentMap, "atk-1", "s1", effectSelections)).toBe(false);
    expect(canAssignBlocker(currentMap, "atk-1", "s2", effectSelections)).toBe(false);
  });

  it("multi-attacker duplicate blocker prevention via patterns", () => {
    // 2 アタッカー、ブロッカー s1, s2
    const multiAtkSelections: EffectSelection[] = [
      {
        selectionType: "unitAssignment",
        assignments: [
          { sourceUnitId: "atk-1", selectedUnitIds: [] },
          { sourceUnitId: "atk-2", selectedUnitIds: [] },
        ],
      },
      {
        selectionType: "unitAssignment",
        assignments: [
          { sourceUnitId: "atk-1", selectedUnitIds: ["s1"] },
          { sourceUnitId: "atk-2", selectedUnitIds: [] },
        ],
      },
      {
        selectionType: "unitAssignment",
        assignments: [
          { sourceUnitId: "atk-1", selectedUnitIds: ["s1"] },
          { sourceUnitId: "atk-2", selectedUnitIds: ["s2"] },
        ],
      },
    ];

    // atk-1 に s1 を割り当て
    const currentMap: AttackerBlockMap = {
      "atk-1": ["s1"],
      "atk-2": [],
    };

    // atk-2 に s2 の割当ては可能
    expect(canAssignBlocker(currentMap, "atk-2", "s2", multiAtkSelections)).toBe(true);

    // atk-2 に s1 (重複) の割当てはパターン集合に存在しないため不可
    expect(canAssignBlocker(currentMap, "atk-2", "s1", multiAtkSelections)).toBe(false);
  });
});
