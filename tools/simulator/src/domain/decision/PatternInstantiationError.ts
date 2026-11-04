/**
 * ストリーミング合法手（BlockAssignmentStreamProvider）の論理インデックスから
 * Core LegalPattern の事前実体化（materialization）に失敗した場合にスローされる専用エラー。
 * 一般の例外やルール違反例外と明確に区別してテレメトリー追跡可能にする。
 */
export class PatternInstantiationError extends Error {
  public readonly selectedPatternRef: number;
  public readonly streamPatternCount?: number;

  constructor(selectedPatternRef: number, streamPatternCount?: number, message?: string) {
    super(
      message ??
        `ストリーミングインデックス ${selectedPatternRef} の事前実体化に失敗しました。` +
        (streamPatternCount !== undefined ? ` (総合法手パターン数: ${streamPatternCount})` : "")
    );
    this.name = "PatternInstantiationError";
    this.selectedPatternRef = selectedPatternRef;
    this.streamPatternCount = streamPatternCount;
  }
}
