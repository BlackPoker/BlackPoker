export interface FormattedLogEntry {
  message: string;
  level: "info" | "event" | "action" | "trigger" | "system";
}

/**
 * 盤面状態の変化 (State / Stage / RequestBuffer) から人間向けのゲームログメッセージを生成します。
 */
export class GameEventFormatter {
  /**
   * 前後の State と解決アクション情報から、発生したイベントのログ配列を生成します。
   */
  static formatStateTransition(
    prevState: any,
    nextState: any
  ): FormattedLogEntry[] {
    const logs: FormattedLogEntry[] = [];
    if (!prevState || !nextState) return logs;

    const getPlayerName = (pKey: string) => {
      return nextState.players?.[pKey]?.name || (pKey === "p1" ? "Player A" : "Player B");
    };

    // 1. ターン交代の検知
    if (prevState.turnPlayer !== nextState.turnPlayer) {
      const nextTPName = getPlayerName(nextState.turnPlayer);
      logs.push({
        message: `🔄 ターン交代: ${nextTPName} (${nextState.turnPlayer}) の手番になりました (Turn ${nextState.turnCount})`,
        level: "info",
      });
    }

    // 2. ライフ変化 (ダメージ / ドロー被弾) の検知
    for (const pKey of ["p1", "p2"]) {
      const prevLife = Array.isArray(prevState.players?.[pKey]?.life) ? prevState.players[pKey].life.length : 0;
      const nextLife = Array.isArray(nextState.players?.[pKey]?.life) ? nextState.players[pKey].life.length : 0;
      const pName = getPlayerName(pKey);

      if (prevLife > nextLife) {
        const diff = prevLife - nextLife;
        // 手札が増えている場合はドロー、手札が増えていない場合はダメージ被弾
        const prevHand = Array.isArray(prevState.players?.[pKey]?.hand) ? prevState.players[pKey].hand.length : 0;
        const nextHand = Array.isArray(nextState.players?.[pKey]?.hand) ? nextState.players[pKey].hand.length : 0;

        if (nextHand > prevHand) {
          const drawCount = nextHand - prevHand;
          logs.push({
            message: `🎴 ${pName} がライフから ${drawCount}枚 ドローしました (残りライフ: ${nextLife}枚)`,
            level: "event",
          });
        } else {
          logs.push({
            message: `💥 ${pName} に ${diff} ダメージ！ (残りライフ: ${nextLife}枚)`,
            level: "event",
          });
        }
      }
    }

    // 3. フィールド -> 墓地移動の検知 (ユニット破壊/相打ち)
    for (const pKey of ["p1", "p2"]) {
      const prevGrave = Array.isArray(prevState.players?.[pKey]?.grave) ? prevState.players[pKey].grave.length : 0;
      const nextGrave = Array.isArray(nextState.players?.[pKey]?.grave) ? nextState.players[pKey].grave.length : 0;
      const pName = getPlayerName(pKey);

      if (nextGrave > prevGrave) {
        // 新しく墓地に入ったユニット
        const prevFieldIds = new Set(prevState.players?.[pKey]?.field?.map((u: any) => u.unitId) || []);
        const nextFieldIds = new Set(nextState.players?.[pKey]?.field?.map((u: any) => u.unitId) || []);

        for (const u of prevState.players?.[pKey]?.field || []) {
          if (!nextFieldIds.has(u.unitId)) {
            const unitLabel = u.kind || (u.componentId === "character.bulwark" ? "防壁" : "兵士");
            logs.push({
              message: `☠️ ${pName} の ${unitLabel} (${u.unitId.slice(-5)}) が墓地へ送られました`,
              level: "event",
            });
          }
        }
      }
    }

    // 4. チャージ状態への復帰検知
    for (const pKey of ["p1", "p2"]) {
      const prevUnits = prevState.players?.[pKey]?.field || [];
      const nextUnits = nextState.players?.[pKey]?.field || [];
      const pName = getPlayerName(pKey);

      const chargedUnits = nextUnits.filter((nu: any) => {
        const pu = prevUnits.find((u: any) => u.unitId === nu.unitId);
        return pu && pu.state === "drive" && nu.state === "charge";
      });

      if (chargedUnits.length > 0 && prevState.turnPlayer !== nextState.turnPlayer && nextState.turnPlayer === pKey) {
        logs.push({
          message: `⚡ ${pName} のフィールド全キャラクター (${chargedUnits.length}体) がチャージ状態に復帰しました`,
          level: "info",
        });
      }
    }

    // 5. Stage リクエスト積載 / 解決の検知
    const prevStageReqs = prevState.stage?.requests || [];
    const nextStageReqs = nextState.stage?.requests || [];

    if (nextStageReqs.length > prevStageReqs.length) {
      // 新しく積載されたリクエスト
      const newReq = nextStageReqs[nextStageReqs.length - 1];
      const actName = newReq.action?.name || newReq.actionId;
      const cName = getPlayerName(newReq.controller);
      logs.push({
        message: `📥 「${actName}」がステージに積載されました (発動者: ${cName})`,
        level: "trigger",
      });
    }

    return logs;
  }
}
