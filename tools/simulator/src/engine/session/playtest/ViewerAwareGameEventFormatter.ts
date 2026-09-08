import { CombatResult } from "../../../domain/rules/DamageJudgeResult";
import { getUnitDisplayName } from "../../rules/characterUtils";
import { formatSuitSymbol } from "../../rules/cardUtils";
import { PlayerKey } from "../../../domain/decision/DecisionSource";
import {
  PlaytestPresentationEvent,
  PlaytestPresentationEventKind,
  createDeterministicPresentationEventId,
} from "./PlaytestPresentationEvent";

function formatCardCodeDisplay(code?: string): string {
  if (!code) return "";
  return code
    .replace(/S/gi, "♠")
    .replace(/H/gi, "♡")
    .replace(/D/gi, "♢")
    .replace(/C/gi, "♣");
}

/**
 * 閲覧プレイヤー（viewerPlayerId）の視点に応じた構造化ゲームログを生成します。
 * Human vs AI において、相手（AI）の非公開情報（手札カード名、10枚以上のライフ正確数等）が
 * 通常ログに漏洩することを防止します。
 *
 * 戻り値は PlaytestPresentationEvent[] であり、FormattedLogEntry[] と完全な後方互換性を持ちます。
 */
export class ViewerAwareGameEventFormatter {
  /**
   * 前後の State と解決アクション情報から、閲覧者視点に合わせたプレゼンテーションイベント配列を生成します。
   * viewerPlayerId が undefined の場合は従来通り全情報（Pass-and-Play用）を出力します。
   */
  static formatStateTransition(
    prevState: any,
    nextState: any,
    viewerPlayerId?: PlayerKey
  ): PlaytestPresentationEvent[] {
    const events: PlaytestPresentationEvent[] = [];
    if (!prevState || !nextState) return events;

    const stateVersion = nextState.stateVersion ?? nextState.version ?? 1;
    let localIndex = 0;

    const createEvent = (
      kind: PlaytestPresentationEventKind,
      message: string,
      level: "info" | "action" | "event" | "system",
      extra: Partial<PlaytestPresentationEvent> = {}
    ): PlaytestPresentationEvent => {
      return {
        id: createDeterministicPresentationEventId(stateVersion, localIndex++, kind),
        stateVersion,
        kind,
        message,
        level,
        ...extra,
      };
    };

    const getPlayerName = (pKey: string) => {
      return nextState.players?.[pKey]?.name || (pKey === "p1" ? "Player A" : "Player B");
    };

    // 1. ターン交代の検知
    if (prevState.turnPlayer !== nextState.turnPlayer) {
      const nextTPName = getPlayerName(nextState.turnPlayer);
      events.push(
        createEvent(
          "TURN_CHANGED",
          `[TURN] ターン交代: ${nextTPName} (${nextState.turnPlayer}) の手番になりました (Turn ${nextState.turnCount})`,
          "info",
          {
            actorPlayerId: nextState.turnPlayer,
            actorName: nextTPName,
          }
        )
      );
    }

    // 1.5. 新規 Stage リクエスト積載 & コスト支払いの検知
    let paidLifePlayerKey: string | null = null;
    let paidLifeCount = 0;
    const prevStageReqIds = new Set(prevState.stage?.requests?.map((r: any) => r.id) || []);
    const nextStageReqs = nextState.stage?.requests || [];
    for (const req of nextStageReqs) {
      if (!prevStageReqIds.has(req.id)) {
        const costPayment = req.selectedCostPayment;
        if (costPayment) {
          const cName = getPlayerName(req.controller);
          const parts: string[] = [];

          if (costPayment.discardedCardIds && costPayment.discardedCardIds.length > 0) {
            const isOpponentSecret = viewerPlayerId && req.controller !== viewerPlayerId;
            if (isOpponentSecret) {
              // 相手の手札破棄: 非公開情報保護のため枚数のみ表示
              parts.push(`手札破棄: ${costPayment.discardedCardIds.length}枚 → 墓地`);
            } else {
              // 自身の破棄またはPass-and-Play: カードコードを表示
              const prevHand = prevState.players?.[req.controller]?.hand || [];
              const discardedCodes = costPayment.discardedCardIds.map((cId: string) => {
                const c = prevHand.find((card: any) => card.id === cId);
                return formatCardCodeDisplay(c?.code || (c?.suit && c?.rank ? `${c.suit}${c.rank}` : cId));
              });
              parts.push(`手札破棄: ${discardedCodes.join(", ")} → 墓地`);
            }
          }

          if (costPayment.drivenBulwarkUnitIds && costPayment.drivenBulwarkUnitIds.length > 0) {
            parts.push(`防壁 ${costPayment.drivenBulwarkUnitIds.length}枚をdrive`);
          }

          if (costPayment.lifeCount && costPayment.lifeCount > 0) {
            parts.push(`ライフ ${costPayment.lifeCount}枚支払い`);
            paidLifePlayerKey = req.controller;
            paidLifeCount += costPayment.lifeCount;
          }

          if (costPayment.sacrificedUnitIds && costPayment.sacrificedUnitIds.length > 0) {
            parts.push(`ユニット ${costPayment.sacrificedUnitIds.length}体破壊`);
          }

          if (parts.length > 0) {
            events.push(
              createEvent(
                "COST_PAID",
                `[COST] ${cName} がコストを支払いました: ${parts.join(" / ")}`,
                "action",
                {
                  actorPlayerId: req.controller,
                  actorName: cName,
                  requestId: req.id,
                  sourceRequestId: req.id,
                }
              )
            );
          }
        }
      }
    }

    // 2. Stage リクエスト解決の検知
    const calculatedDamageByPlayer: Record<string, number> = {};
    const prevStageHistory = prevState.stage?.history || [];
    const nextStageHistory = nextState.stage?.history || [];
    let newlyResolved: any[] = [];
    if (nextStageHistory.length > prevStageHistory.length) {
      newlyResolved = nextStageHistory.slice(prevStageHistory.length);
      for (const res of newlyResolved) {
        const actName = res.action?.name || res.actionId;
        const cName = getPlayerName(res.controller);

        const reqTarget = Array.isArray(res.targets)
          ? res.targets.find((t: any) => t?.type === "request" || t?.selector === "request")
          : undefined;
        const targetRequestId = reqTarget
          ? (reqTarget.requestId || reqTarget.targetRequestId || reqTarget.id)
          : (res as any).targetRequestId;

        const unitTarget = Array.isArray(res.targets)
          ? res.targets.find((t: any) => t?.type === "unit" || t?.selector === "unit")
          : undefined;
        const targetUnitId = unitTarget
          ? (unitTarget.unitId || unitTarget.targetUnitId || unitTarget.id)
          : (res as any).targetUnitId;

        // E-1: キャンセル済みリクエストの正確な表示 ([RESOLVE] ではなく [CANCELLED])
        if (res.status === "cancelled") {
          events.push(
            createEvent(
              "REQUEST_CANCELLED",
              `[CANCELLED] ${cName} の「${actName}」が無効化されました`,
              "event",
              {
                actorPlayerId: res.controller,
                actorName: cName,
                actionId: res.actionId,
                actionName: actName,
                requestId: res.id || res.requestId,
                sourceRequestId: res.id || res.requestId,
                targetRequestId: targetRequestId,
                targetUnitId: targetUnitId,
              }
            )
          );
          // キャンセルされたリクエストは効果・戦闘判定を実行していないため後続スキップ
          continue;
        }

        events.push(
          createEvent(
            "ACTION_RESOLVED",
            `[RESOLVE] 「${actName}」が解決されました (発動者: ${cName})`,
            "event",
            {
              actorPlayerId: res.controller,
              actorName: cName,
              actionId: res.actionId,
              actionName: actName,
              requestId: res.id || res.requestId,
              sourceRequestId: res.id || res.requestId,
              targetRequestId: targetRequestId,
              targetUnitId: targetUnitId,
            }
          )
        );

        const remainingCount = nextState.stage?.requests?.length || 0;
        if (remainingCount > 0) {
          const topRemaining = nextState.stage.requests[nextState.stage.requests.length - 1];
          const topRemainingName = topRemaining.action?.name || topRemaining.actionId;
          events.push(
            createEvent(
              "STAGE_REMOVED",
              `[STAGE] Stage TOP から「${actName}」を除去 (残りStage: ${remainingCount}件 - 「${topRemainingName}」)`,
              "info",
              {
                sourceRequestId: res.id || res.requestId,
              }
            )
          );
        }

        // ダメージ判定の詳細ログを出力 (Action ID依存を撤廃し、result.damageJudge.combats の存在で判定)
        if (res.result?.damageJudge?.combats) {
          const combats: CombatResult[] = res.result.damageJudge.combats;
          let combatIdx = 1;
          for (const combat of combats) {
            const atkPlayerName = getPlayerName(combat.attackerPlayerKey);
            const atkCard = formatCardCodeDisplay(combat.attackerCardCode);
            const atkLabel = `${atkPlayerName} の一般兵 [${atkCard}]`;

            if (combat.combatType === "unblocked") {
              const dmg = combat.directDamageAmount ?? combat.attackerInitialSize;
              if (combat.targetPlayerKey && dmg > 0) {
                calculatedDamageByPlayer[combat.targetPlayerKey] =
                  (calculatedDamageByPlayer[combat.targetPlayerKey] || 0) + dmg;
              }
              // E-2: 未ブロック攻撃サイズを明記し、ここでの重複 [DAMAGE] イベントは発行しない (ライフ差分検出側で単一発行)
              events.push(
                createEvent(
                  "DAMAGE_JUDGE",
                  `[DAMAGE_JUDGE] ${combats.length > 1 ? `(${combatIdx}) ` : ""}${atkLabel} は未ブロック (攻撃サイズ: ${dmg})`,
                  "action",
                  {
                    actorPlayerId: combat.attackerPlayerKey as PlayerKey,
                    actorName: atkPlayerName,
                    targetLabel: getPlayerName(combat.targetPlayerKey || ""),
                    calculatedDamage: dmg,
                  }
                )
              );
            } else if (combat.combatType === "soldierVsSoldiers") {
              const blkPlayerName = getPlayerName(combat.blockerPlayerKey || "");
              const blkLabels = (combat.blockerCardCodes || []).map(
                (code) => `${blkPlayerName} の一般兵 [${formatCardCodeDisplay(code)}]`
              );
              events.push(
                createEvent(
                  "DAMAGE_JUDGE",
                  `[DAMAGE_JUDGE] ${combats.length > 1 ? `(${combatIdx}) ` : ""}${atkLabel} vs ${blkLabels.join(" + ")}`,
                  "action",
                  {
                    actorPlayerId: combat.attackerPlayerKey as PlayerKey,
                    actorName: atkPlayerName,
                  }
                )
              );
              events.push(
                createEvent(
                  "GENERIC",
                  `[JUDGE_DETAIL] サイズ比較: attacker ${combat.attackerInitialSize} vs blockers ${combat.blockerInitialTotalSize ?? 0}`,
                  "info"
                )
              );

              if (combat.attackerMovedToGrave && combat.blockersMovedToGrave.length > 0) {
                events.push(
                  createEvent(
                    "UNIT_DEFEATED",
                    `[DEFEATED] 結果: 両者死亡 (相打ち)`,
                    "event",
                    {
                      sourceRequestId: res.id || res.requestId,
                    }
                  )
                );
              } else if (combat.attackerMovedToGrave) {
                events.push(
                  createEvent(
                    "UNIT_DEFEATED",
                    `[DEFEATED] 結果: アタッカー死亡 / ブロッカー生存`,
                    "event",
                    {
                      sourceRequestId: res.id || res.requestId,
                    }
                  )
                );
              } else if (combat.blockersMovedToGrave.length > 0) {
                events.push(
                  createEvent(
                    "UNIT_DEFEATED",
                    `[DEFEATED] 結果: ブロッカー死亡 / アタッカー生存`,
                    "event",
                    {
                      sourceRequestId: res.id || res.requestId,
                    }
                  )
                );
              }
            } else if (combat.combatType === "soldierVsBulwark") {
              const blkPlayerName = getPlayerName(combat.blockerPlayerKey || "");
              const bulwarkCode = formatCardCodeDisplay(combat.blockerCardCodes?.[0]);
              events.push(
                createEvent(
                  "DAMAGE_JUDGE",
                  `[DAMAGE_JUDGE] ${combats.length > 1 ? `(${combatIdx}) ` : ""}${atkLabel} vs ${blkPlayerName} の防壁 [${bulwarkCode}]`,
                  "action",
                  {
                    actorPlayerId: combat.attackerPlayerKey as PlayerKey,
                    actorName: atkPlayerName,
                  }
                )
              );
              events.push(
                createEvent(
                  "BULWARK_JUDGE",
                  `[BULWARK_JUDGE] 防壁判定: printed rank ${combat.bulwarkRank || "?"} ${combat.bulwarkMatched ? "一致" : "不一致"}`,
                  "info"
                )
              );

              if (combat.attackerMovedToGrave) {
                events.push(
                  createEvent(
                    "UNIT_DEFEATED",
                    `[DEFEATED] 結果: アタッカー死亡 / 防壁死亡`,
                    "event",
                    {
                      sourceRequestId: res.id || res.requestId,
                    }
                  )
                );
              } else {
                events.push(
                  createEvent(
                    "UNIT_DEFEATED",
                    `[DEFEATED] 結果: 防壁死亡 / アタッカー生存`,
                    "event",
                    {
                      sourceRequestId: res.id || res.requestId,
                    }
                  )
                );
              }
            }
            combatIdx++;
          }
        }
      }
    }

    // 3. ユニット状態トグル (ツイスト等) の検知 (同ターン内)
    // E-4: #eset 等の末尾 slice を廃止し、getUnitDisplayName とプレイヤー名を正規利用
    if (prevState.turnPlayer === nextState.turnPlayer) {
      for (const pKey of ["p1", "p2"]) {
        const prevUnits = prevState.players?.[pKey]?.field || [];
        const nextUnits = nextState.players?.[pKey]?.field || [];
        const pName = getPlayerName(pKey);

        for (const nu of nextUnits) {
          const pu = prevUnits.find((u: any) => u.unitId === nu.unitId);
          if (pu && pu.state !== nu.state) {
            const unitLabel = getUnitDisplayName(nu, nextUnits);
            const fullUnitName = `${pName} の ${unitLabel}`;

            // 因果関係の明示 (A. Causality fallbackの一意性)
            // newlyResolved の中でこの unitId を対象とする解決リクエストが「ちょうど1件」の場合のみ紐付け
            let sourceReqId: string | undefined;
            if (newlyResolved && newlyResolved.length > 0) {
              const matchingReqs = newlyResolved.filter((r: any) => {
                const uTarget = Array.isArray(r.targets)
                  ? r.targets.find((t: any) => t?.type === "unit" || t?.selector === "unit")
                  : undefined;
                return uTarget && (uTarget.unitId || uTarget.targetUnitId || uTarget.id) === nu.unitId;
              });
              if (matchingReqs.length === 1) {
                sourceReqId = matchingReqs[0].id || matchingReqs[0].requestId;
              }
              // 複数件または0件の場合は推測禁止 (sourceReqId は undefined)
            }

            events.push(
              createEvent(
                "UNIT_STATE_CHANGED",
                `[STATE] ${fullUnitName} が ${pu.state} → ${nu.state} に切り替わりました`,
                "event",
                {
                  actorPlayerId: pKey as PlayerKey,
                  actorName: pName,
                  unitId: nu.unitId,
                  unitLabel: fullUnitName,
                  fromState: pu.state,
                  toState: nu.state,
                  sourceRequestId: sourceReqId,
                }
              )
            );
          }
        }
      }
    }

    // 4. ライフ変化 (ダメージ / ドロー) の検知
    // E-2: 算出ダメージと実適用ダメージを明瞭に汎用表示
    for (const pKey of ["p1", "p2"]) {
      const prevLife = Array.isArray(prevState.players?.[pKey]?.life) ? prevState.players[pKey].life.length : 0;
      const nextLife = Array.isArray(nextState.players?.[pKey]?.life) ? nextState.players[pKey].life.length : 0;
      const pName = getPlayerName(pKey);

      if (prevLife > nextLife) {
        let diff = prevLife - nextLife;
        if (paidLifePlayerKey === pKey) {
          diff = Math.max(0, diff - paidLifeCount);
        }
        if (diff > 0) {
          const prevHand = Array.isArray(prevState.players?.[pKey]?.hand) ? prevState.players[pKey].hand.length : 0;
          const nextHand = Array.isArray(nextState.players?.[pKey]?.hand) ? nextState.players[pKey].hand.length : 0;

          // 相手のライフ表示: 10以上なら "10枚以上" とし正確枚数を秘匿
          const isOpponent = viewerPlayerId && pKey !== viewerPlayerId;
          const remainingLifeDisplay = isOpponent && nextLife >= 10 ? "10枚以上" : `${nextLife}枚`;

          if (nextHand > prevHand) {
            const drawCount = nextHand - prevHand;
            events.push(
              createEvent(
                "DRAW",
                `[DRAW] ${pName} がライフから ${drawCount}枚 ドローしました (残りライフ: ${remainingLifeDisplay})`,
                "event",
                {
                  actorPlayerId: pKey as PlayerKey,
                  actorName: pName,
                  drawCount,
                  remainingLifeDisplay,
                }
              )
            );
          } else {
            const calc = calculatedDamageByPlayer[pKey];
            let dmgMsg: string;
            if (calc !== undefined && calc !== diff) {
              dmgMsg = `[DAMAGE] ${pName} にダメージ適用 (算出ダメージ: ${calc} / 実適用: ${diff}) (残りライフ: ${remainingLifeDisplay})`;
            } else {
              dmgMsg = `[DAMAGE] ${pName} に ${diff} ダメージ！ (残りライフ: ${remainingLifeDisplay})`;
            }

            events.push(
              createEvent(
                "DAMAGE",
                dmgMsg,
                "event",
                {
                  actorPlayerId: pKey as PlayerKey,
                  actorName: pName,
                  damageAmount: diff,
                  calculatedDamage: calc ?? diff,
                  remainingLifeDisplay,
                }
              )
            );
          }
        }
      }
    }

    // 5. フィールド -> 墓地移動の検知 (ユニット破壊/相打ち)
    // E-4: #eset 等の末尾 slice を廃止
    for (const pKey of ["p1", "p2"]) {
      const prevGrave = Array.isArray(prevState.players?.[pKey]?.grave) ? prevState.players[pKey].grave.length : 0;
      const nextGrave = Array.isArray(nextState.players?.[pKey]?.grave) ? nextState.players[pKey].grave.length : 0;
      const pName = getPlayerName(pKey);

      if (nextGrave > prevGrave) {
        const nextFieldIds = new Set(nextState.players?.[pKey]?.field?.map((u: any) => u.unitId) || []);

        for (const u of prevState.players?.[pKey]?.field || []) {
          if (!nextFieldIds.has(u.unitId)) {
            const unitLabel = getUnitDisplayName(u, prevState.players?.[pKey]?.field);
            const fullUnitName = `${pName} の ${unitLabel}`;
            events.push(
              createEvent(
                "UNIT_DEFEATED",
                `[DEFEATED] ${fullUnitName} が墓地へ送られました`,
                "event",
                {
                  actorPlayerId: pKey as PlayerKey,
                  actorName: pName,
                  unitId: u.unitId,
                  unitLabel: fullUnitName,
                }
              )
            );
          }
        }
      }
    }

    // 6. チャージ状態への復帰検知 (ターン開始時)
    for (const pKey of ["p1", "p2"]) {
      const prevUnits = prevState.players?.[pKey]?.field || [];
      const nextUnits = nextState.players?.[pKey]?.field || [];
      const pName = getPlayerName(pKey);

      const chargedCount = nextUnits.filter((nu: any) => {
        const pu = prevUnits.find((u: any) => u.unitId === nu.unitId);
        return pu && pu.state === "drive" && nu.state === "charge";
      }).length;

      if (chargedCount > 0 && prevState.turnPlayer !== nextState.turnPlayer) {
        events.push(
          createEvent(
            "CHARGE_RESTORED",
            `[CHARGE] ${pName} のユニット ${chargedCount}体が CHARGE (縦向き) に復帰しました`,
            "info",
            {
              actorPlayerId: pKey as PlayerKey,
              actorName: pName,
            }
          )
        );
      }
    }

    return events;
  }
}

