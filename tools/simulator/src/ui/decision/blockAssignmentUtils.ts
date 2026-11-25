import { EffectSelection, UnitAssignment } from "../../domain/decision/DecisionCatalog";
import { BlockAssignmentStreamProvider, DecisionRequest } from "../../domain/decision/DecisionRequest";

export interface AttackerBlockMap {
  [attackerUnitId: string]: string[];
}

/**
 * DecisionRequest がブロック割当判断かどうかを判定（配列方式・ストリーミング方式両対応）
 */
export function isBlockAssignmentRequest(request: Readonly<DecisionRequest>): boolean {
  if (request.blockAssignmentStream || request.blockAssignmentStreamMeta) {
    return true;
  }
  return (request.catalog.effectSelections || []).some(
    (eff) => eff.selectionType === "unitAssignment" || eff.assignments !== undefined
  );
}

/**
 * 2つのブロッカーID配列が同値（順不同一致）か判定
 */
export function areBlockerIdsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 * 2つの UnitAssignment 配列が完全一致するか判定
 */
export function isAssignmentExactMatch(
  currentMap: AttackerBlockMap,
  targetAssignments: readonly UnitAssignment[]
): boolean {
  const targetMap: { [attackerUnitId: string]: readonly string[] } = {};
  for (const asgn of targetAssignments) {
    targetMap[asgn.sourceUnitId] = asgn.selectedUnitIds || [];
  }

  const allAttackerIds = Array.from(
    new Set([...Object.keys(currentMap), ...Object.keys(targetMap)])
  );

  for (const atkId of allAttackerIds) {
    const curBlockers = currentMap[atkId] || [];
    const tgtBlockers = targetMap[atkId] || [];
    if (!areBlockerIdsEqual(curBlockers, tgtBlockers)) {
      return false;
    }
  }

  return true;
}

/**
 * 現在の部分割当てに適合し得る Legal Pattern のインデックス一覧を検索
 */
export function findMatchingEffectSelectionIndices(
  currentMap: AttackerBlockMap,
  effectSelections: readonly EffectSelection[]
): number[] {
  const matchingIndices: number[] = [];

  effectSelections.forEach((effSel, idx) => {
    if (!effSel.assignments) return;
    const targetMap: { [attackerUnitId: string]: readonly string[] } = {};
    for (const asgn of effSel.assignments) {
      targetMap[asgn.sourceUnitId] = asgn.selectedUnitIds || [];
    }

    // currentMap で指定されたブロッカーが targetMap に包含されているか
    let isCandidate = true;
    for (const [atkId, curBlockers] of Object.entries(currentMap)) {
      if (curBlockers.length === 0) continue;
      const tgtBlockers = targetMap[atkId] || [];
      // curBlockers のすべてのIDが tgtBlockers に含まれていること
      const containsAll = curBlockers.every((bId) => tgtBlockers.includes(bId));
      if (!containsAll) {
        isCandidate = false;
        break;
      }
    }

    if (isCandidate) {
      matchingIndices.push(idx);
    }
  });

  return matchingIndices;
}

/**
 * 特定のアタッカーにあるブロッカーを追加/トグルした場合に、適合する合法パターンが存在するか検証
 */
export function canAssignBlocker(
  currentMap: AttackerBlockMap,
  attackerUnitId: string,
  blockerUnitId: string,
  effectSelections: readonly EffectSelection[],
  stream?: BlockAssignmentStreamProvider
): boolean {
  const curList = currentMap[attackerUnitId] || [];
  let nextList: string[];
  if (curList.includes(blockerUnitId)) {
    // トグルOFF（削除）は常に可能
    return true;
  } else {
    // トグルON（追加）
    nextList = [...curList, blockerUnitId];
  }

  const hypotheticalMap: AttackerBlockMap = {
    ...currentMap,
    [attackerUnitId]: nextList,
  };

  if (effectSelections.length === 0 && stream) {
    for (const targetAssignments of stream.iterateAssignments()) {
      const targetMap: { [atkId: string]: readonly string[] } = {};
      for (const asgn of targetAssignments) {
        targetMap[asgn.sourceUnitId] = asgn.selectedUnitIds || [];
      }
      let isCandidate = true;
      for (const [atkId, curBlockers] of Object.entries(hypotheticalMap)) {
        if (curBlockers.length === 0) continue;
        const tgtBlockers = targetMap[atkId] || [];
        if (!curBlockers.every((bId) => tgtBlockers.includes(bId))) {
          isCandidate = false;
          break;
        }
      }
      if (isCandidate) return true;
    }
    return false;
  }

  const matches = findMatchingEffectSelectionIndices(hypotheticalMap, effectSelections);
  return matches.length > 0;
}

/**
 * 現在の割当てと完全一致する Pattern のインデックス (patternRef) を検索
 */
export function findExactMatchPatternRef(
  currentMap: AttackerBlockMap,
  effectSelections: readonly EffectSelection[],
  stream?: BlockAssignmentStreamProvider
): number | null {
  if (effectSelections.length === 0 && stream) {
    let idx = 0;
    for (const assignments of stream.iterateAssignments()) {
      if (isAssignmentExactMatch(currentMap, assignments)) {
        return idx;
      }
      idx++;
    }
    return null;
  }

  for (let i = 0; i < effectSelections.length; i++) {
    const effSel = effectSelections[i];
    if (effSel.assignments && isAssignmentExactMatch(currentMap, effSel.assignments)) {
      return i;
    }
  }
  return null;
}
