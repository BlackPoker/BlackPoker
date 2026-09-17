/**
 * EffectPathCodec
 *
 * EffectTree 内の中断・再開位置（effectPath: readonly number[]）の
 * 決定論的エンコード・デコード・検証を行う汎用コーデック。
 *
 * 【フォーマット仕様】
 * - トップレベル: [topIndex] (例: [0], [3])
 * - ブランチネスト: [parentIndex, branchCode, ...childPath]
 *   - branchCode: 0 = THEN, 1 = ELSE
 *   - 例: [2, 0, 1] -> index 2 の効果の then ブランチ内 index 1
 *   - 例: [2, 1, 0] -> index 2 の効果の else ブランチ内 index 0
 *   - 再帰ネスト: [parentIndex, branchCode, innerIndex, innerBranchCode, ...]
 *
 * 単一要素の [index] との完全な後方互換性を維持します。
 */

export enum EffectBranchCode {
  THEN = 0,
  ELSE = 1,
}

export type BranchIdentity = 'then' | 'else';

export function branchNameToCode(branch: BranchIdentity): EffectBranchCode {
  return branch === 'then' ? EffectBranchCode.THEN : EffectBranchCode.ELSE;
}

export function branchCodeToName(code: number): BranchIdentity {
  if (code === EffectBranchCode.THEN) return 'then';
  if (code === EffectBranchCode.ELSE) return 'else';
  throw new Error(`EffectPathCodec: 未知の branchCode です: ${code} (有効値: 0=then, 1=else)`);
}

export class EffectPathCodec {
  /**
   * トップレベル効果のパスを生成
   */
  static createTopLevelPath(index: number): number[] {
    return [index];
  }

  /**
   * ブランチ内のネストパスを生成
   */
  static createBranchPath(
    parentIndex: number,
    branch: BranchIdentity | EffectBranchCode,
    childPath: readonly number[] | number
  ): number[] {
    const code = typeof branch === 'string' ? branchNameToCode(branch) : branch;
    const childArray = typeof childPath === 'number' ? [childPath] : [...childPath];
    return [parentIndex, code, ...childArray];
  }

  /**
   * 現在のパスから最上位の effect index を取得
   */
  static getTopIndex(path: readonly number[]): number {
    return path.length > 0 ? path[0] : 0;
  }

  /**
   * 指定した親 index の下にある branch と残りの childPath を抽出
   */
  static matchNestedBranch(
    path: readonly number[],
    parentIndex: number
  ): {
    matches: boolean;
    branch?: BranchIdentity;
    branchCode?: EffectBranchCode;
    childPath: readonly number[];
  } {
    if (path.length >= 3 && path[0] === parentIndex) {
      const code = path[1];
      const branch = branchCodeToName(code);
      return {
        matches: true,
        branch,
        branchCode: code,
        childPath: path.slice(2),
      };
    }
    return {
      matches: false,
      childPath: [],
    };
  }

  /**
   * パスの末尾インデックスを 1 進めた新しいパスを生成
   * 例: [0] -> [1]
   * 例: [2, 0, 0] -> [2, 0, 1]
   */
  static advanceLastIndex(path: readonly number[]): readonly number[] {
    const p = [...path];
    if (p.length > 0) {
      p[p.length - 1] = p[p.length - 1] + 1;
      return p;
    }
    return [1];
  }

  /**
   * パスまたはインデックスの正規化 (後方互換性保証)
   */
  static normalize(pathOrIndex: number | readonly number[] | undefined): readonly number[] {
    if (pathOrIndex === undefined) return [0];
    if (typeof pathOrIndex === 'number') return [pathOrIndex];
    if (pathOrIndex.length === 0) return [0];
    return pathOrIndex;
  }
}
