/**
 * プレイヤー（人間またはAI）からエンジンへ返却される判断回答。
 */
export interface DecisionResponse {
  readonly decisionId: string;
  readonly stateVersion: number;

  /**
   * DecisionRequest.patternsの0始まり配列番号。
   */
  readonly selectedPatternRef: number;
}
