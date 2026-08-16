/**
 * チャンス進行における連続パス状態（Consecutive Pass）を管理するトラッカー。
 */
export class PassTracker {
  private _consecutivePassCount: number = 0;

  constructor(initialCount: number = 0) {
    this._consecutivePassCount = initialCount;
  }

  /**
   * 現在の連続パス回数
   */
  get consecutivePassCount(): number {
    return this._consecutivePassCount;
  }

  /**
   * プレイヤーがパスを選択した際に記録
   */
  recordPass(): void {
    this._consecutivePassCount += 1;
  }

  /**
   * 新しいアクションが積まれた場合やステージトップ解決時にリセット
   */
  reset(): void {
    this._consecutivePassCount = 0;
  }

  /**
   * 全プレイヤーが連続してパスしたかどうかを判定
   * （2人対戦では consecutivePassCount >= 2）
   */
  isAllPassed(playerCount: number = 2): boolean {
    return this._consecutivePassCount >= playerCount;
  }
}
