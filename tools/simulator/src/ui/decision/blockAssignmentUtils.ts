import { EffectSelection, UnitAssignment } from "../../domain/decision/DecisionCatalog";

export interface AttackerBlockMap {
  [attackerUnitId: string]: string[];
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
  effectSelections: readonly EffectSelection[]
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

  const matches = findMatchingEffectSelectionIndices(hypotheticalMap, effectSelections);
  return matches.length > 0;
}

/**
 * 現在の割当てと完全一致する Pattern のインデックス (patternRef) を検索
 */
export function findExactMatchPatternRef(
  currentMap: AttackerBlockMap,
  effectSelections: readonly EffectSelection[]
): number | null {
  for (let i = 0; i < effectSelections.length; i++) {
    const effSel = effectSelections[i];
    if (effSel.assignments && isAssignmentExactMatch(currentMap, effSel.assignments)) {
      return i;
    }
  }
  return null;
}
