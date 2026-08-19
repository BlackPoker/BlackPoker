import { CommandContext } from "./CommandRegistry";
import { AbilityEvaluator } from "./AbilityEvaluator";
import { EffectInterpreter } from "./EffectInterpreter";
import { isSoldierType, isBulwarkType } from "./characterUtils";
import { isJokerCard, matchesCardNumber } from "./cardUtils";
import { getOpponentPlayerKey } from "./playerUtils";
import { moveUnitToGraveyard, MoveUnitMetadata } from "./commandHandlers";

export interface CombatResult {
  readonly attackerUnitId: string;
  readonly attackerPlayerKey: string;
  readonly combatType: "unblocked" | "soldierVsSoldiers" | "soldierVsBulwark" | "unsupported";
  readonly blockerUnitIds: readonly string[];
  readonly blockerPlayerKey?: string;
  readonly attackerInitialSize: number;
  readonly blockerInitialTotalSize?: number;
  readonly attackerMovedToGrave: boolean;
  readonly blockersMovedToGrave: readonly string[];
  readonly directDamageDealt?: number;
  readonly targetPlayerKey?: string;
  readonly bulwarkRevealed?: boolean;
  readonly bulwarkMatched?: boolean;
}

export interface DamageJudgeResult {
  readonly combats: readonly CombatResult[];
  readonly orphanBlockerUnitIds: readonly { blockerUnitId: string; blockerPlayerKey: string }[];
}

/**
 * 1. 未ブロック戦闘（ブロッカー不在）の計算
 */
export function resolveUnblockedCombat(
  attacker: any,
  attackerPlayerKey: string,
  context: CommandContext,
  abilityEvaluator: AbilityEvaluator
): CombatResult {
  const attackerSize = abilityEvaluator.calculateUnitSize(attacker, context.state.players[attackerPlayerKey]);
  const targetPlayerKey = attacker.battle?.targetPlayerKey || getOpponentPlayerKey(attackerPlayerKey, context.state);

  return {
    attackerUnitId: attacker.unitId,
    attackerPlayerKey,
    combatType: "unblocked",
    blockerUnitIds: [],
    attackerInitialSize: attackerSize,
    attackerMovedToGrave: false,
    blockersMovedToGrave: [],
    directDamageDealt: attackerSize,
    targetPlayerKey,
  };
}

/**
 * 2. 兵士アタッカー vs 複数兵士ブロッカーの戦闘計算（サイズ比較）
 */
export function resolveSoldierVsSoldiersCombat(
  attacker: any,
  attackerPlayerKey: string,
  blockers: readonly any[],
  blockerPlayerKey: string,
  context: CommandContext,
  abilityEvaluator: AbilityEvaluator
): CombatResult {
  const attackerSize = abilityEvaluator.calculateUnitSize(attacker, context.state.players[attackerPlayerKey]);
  const blockerSizes = blockers.map((b) =>
    abilityEvaluator.calculateUnitSize(b, context.state.players[blockerPlayerKey])
  );
  const blockerTotalSize = blockerSizes.reduce((sum, s) => sum + s, 0);

  let attackerMovedToGrave = false;
  let blockersMovedToGrave: string[] = [];

  if (attackerSize > blockerTotalSize) {
    // ブロッカー側敗北 -> ブロッカー全員墓地へ
    attackerMovedToGrave = false;
    blockersMovedToGrave = blockers.map((b) => b.unitId);
  } else if (attackerSize < blockerTotalSize) {
    // アタッカー側敗北 -> アタッカーのみ墓地へ、ブロッカー全員生存
    attackerMovedToGrave = true;
    blockersMovedToGrave = [];
  } else {
    // 同値 -> アタッカーおよびブロッカー全員墓地へ
    attackerMovedToGrave = true;
    blockersMovedToGrave = blockers.map((b) => b.unitId);
  }

  return {
    attackerUnitId: attacker.unitId,
    attackerPlayerKey,
    combatType: "soldierVsSoldiers",
    blockerUnitIds: blockers.map((b) => b.unitId),
    blockerPlayerKey,
    attackerInitialSize: attackerSize,
    blockerInitialTotalSize: blockerTotalSize,
    attackerMovedToGrave,
    blockersMovedToGrave,
  };
}

/**
 * 3. 兵士アタッカー vs 防壁ブロッカーの戦闘計算（記載数字照合）
 */
export function resolveSoldierVsBulwarkCombat(
  attacker: any,
  attackerPlayerKey: string,
  bulwark: any,
  blockerPlayerKey: string,
  context: CommandContext,
  abilityEvaluator: AbilityEvaluator
): CombatResult {
  const attackerSize = abilityEvaluator.calculateUnitSize(attacker, context.state.players[attackerPlayerKey]);
  const bulwarkCard = bulwark.cards?.[0];

  const isJoker = isJokerCard(bulwarkCard);
  const isMatched = isJoker || matchesCardNumber(attacker.cards || [], bulwarkCard);

  // 防壁は判定結果に関わらず必ず墓地へ移動する
  const blockersMovedToGrave = [bulwark.unitId];
  const attackerMovedToGrave = isMatched;

  return {
    attackerUnitId: attacker.unitId,
    attackerPlayerKey,
    combatType: "soldierVsBulwark",
    blockerUnitIds: [bulwark.unitId],
    blockerPlayerKey,
    attackerInitialSize: attackerSize,
    attackerMovedToGrave,
    blockersMovedToGrave,
    bulwarkRevealed: true,
    bulwarkMatched: isMatched,
  };
}

/**
 * Calculate Phase:
 * effect-time の盤面状態を基準に全戦闘の判定結果を確定し、DamageJudgeResult を生成します。
 * （盤面変更・墓地移動などの副作用はまだ発生させません）
 */
export function calculateDamageJudge(
  context: CommandContext,
  abilityEvaluator: AbilityEvaluator
): DamageJudgeResult {
  const state = context.state;
  const combats: CombatResult[] = [];
  const handledAttackerIds = new Set<string>();
  const handledBlockerIds = new Set<string>();

  // 1. 盤面上の全アタッカーを収集 (field走査順)
  const attackers: { unit: any; playerKey: string }[] = [];
  for (const [pKey, player] of Object.entries<any>(state.players || {})) {
    if (player.field) {
      for (const unit of player.field) {
        if (unit.battle?.role === "attacker") {
          attackers.push({ unit, playerKey: pKey });
        }
      }
    }
  }

  // 2. 各アタッカーについての戦闘計算
  for (const { unit: attacker, playerKey: attackerPlayerKey } of attackers) {
    handledAttackerIds.add(attacker.unitId);

    // 当該アタッカーをブロックしている盤面上のブロッカー群を収集
    const blockers: { unit: any; playerKey: string }[] = [];
    for (const [pKey, player] of Object.entries<any>(state.players || {})) {
      if (player.field) {
        for (const u of player.field) {
          if (u.battle?.role === "blocker" && u.battle?.blocksUnitId === attacker.unitId) {
            blockers.push({ unit: u, playerKey: pKey });
            handledBlockerIds.add(u.unitId);
          }
        }
      }
    }

    if (blockers.length === 0) {
      // 未ブロック戦闘
      const result = resolveUnblockedCombat(attacker, attackerPlayerKey, context, abilityEvaluator);
      combats.push(result);
    } else {
      const blockerUnits = blockers.map((b) => b.unit);
      const blockerPlayerKey = blockers[0].playerKey;

      const isSingleBulwark =
        blockerUnits.length === 1 && isBulwarkType(blockerUnits[0], context.components);

      if (isSingleBulwark) {
        // 防壁ブロック戦闘
        const result = resolveSoldierVsBulwarkCombat(
          attacker,
          attackerPlayerKey,
          blockerUnits[0],
          blockerPlayerKey,
          context,
          abilityEvaluator
        );
        combats.push(result);
      } else {
        const allSoldiers = blockerUnits.every((b) => isSoldierType(b, context.components));
        if (allSoldiers) {
          // 兵士 vs 複数兵士戦闘
          const result = resolveSoldierVsSoldiersCombat(
            attacker,
            attackerPlayerKey,
            blockerUnits,
            blockerPlayerKey,
            context,
            abilityEvaluator
          );
          combats.push(result);
        } else {
          // 将来の未定義 characterType に対する防御的処理
          combats.push({
            attackerUnitId: attacker.unitId,
            attackerPlayerKey,
            combatType: "unsupported",
            blockerUnitIds: blockerUnits.map((b) => b.unitId),
            blockerPlayerKey,
            attackerInitialSize: abilityEvaluator.calculateUnitSize(attacker, state.players[attackerPlayerKey]),
            attackerMovedToGrave: false,
            blockersMovedToGrave: [],
          });
        }
      }
    }
  }

  // 3. Orphan Blockers（対応するアタッカーが盤面に存在しないブロッカー）の収集
  const orphanBlockers: { blockerUnitId: string; blockerPlayerKey: string }[] = [];
  for (const [pKey, player] of Object.entries<any>(state.players || {})) {
    if (player.field) {
      for (const u of player.field) {
        if (u.battle?.role === "blocker" && !handledBlockerIds.has(u.unitId)) {
          orphanBlockers.push({ blockerUnitId: u.unitId, blockerPlayerKey: pKey });
        }
      }
    }
  }

  return {
    combats,
    orphanBlockerUnitIds: orphanBlockers,
  };
}

/**
 * Apply Phase:
 * 確定した DamageJudgeResult を盤面に適用し、墓地移動・直接ダメージ・battle cleanup を実行します。
 */
export function applyDamageJudgeResult(
  result: DamageJudgeResult,
  context: CommandContext,
  effectInterpreter: EffectInterpreter
): void {
  const state = context.state;

  // 1. 各戦闘結果の適用
  for (const combat of result.combats) {
    const attackerPlayer = state.players[combat.attackerPlayerKey];
    const attackerUnit = attackerPlayer?.field?.find((u: any) => u.unitId === combat.attackerUnitId);

    // 1-1. 防壁の表面化
    if (combat.bulwarkRevealed && combat.blockerPlayerKey) {
      const blockerPlayer = state.players[combat.blockerPlayerKey];
      for (const bId of combat.blockerUnitIds) {
        const blockerUnit = blockerPlayer?.field?.find((u: any) => u.unitId === bId);
        if (blockerUnit) {
          blockerUnit.face = "up";
        }
      }
    }

    // 1-2. 未ブロック時の直接ダメージ
    if (combat.directDamageDealt !== undefined && combat.directDamageDealt > 0) {
      const targetPlayerKey = combat.targetPlayerKey || getOpponentPlayerKey(combat.attackerPlayerKey, state);
      const damageContext: CommandContext = {
        ...context,
        playerKey: combat.attackerPlayerKey,
        targetPlayerKey,
      };

      // dealDamage コマンドの実行 (life -> grave 移動と cardMoved イベント発行)
      ((effectInterpreter as any).registry).execute(
        "dealDamage",
        { target: "targetPlayer", amount: combat.directDamageDealt },
        damageContext
      );
    }

    // 1-3. アタッカーの墓地移動
    if (combat.attackerMovedToGrave) {
      if (attackerUnit) {
        const metadata: MoveUnitMetadata = {
          cause: { type: "effect", command: "judgeDamage", actionId: "action.damageJudge" },
          combatSnapshot: { role: "attacker" },
          characterType: isSoldierType(attackerUnit, context.components) ? "soldier" : undefined,
        };
        moveUnitToGraveyard(
          attackerUnit,
          combat.attackerPlayerKey,
          state,
          effectInterpreter,
          context,
          metadata
        );
      }
    } else {
      // 生存アタッカーの battle cleanup
      if (attackerUnit && attackerUnit.battle) {
        delete attackerUnit.battle;
      }
    }

    // 1-4. ブロッカーの墓地移動
    if (combat.blockersMovedToGrave.length > 0 && combat.blockerPlayerKey) {
      const blockerPlayer = state.players[combat.blockerPlayerKey];
      for (const blockerId of combat.blockersMovedToGrave) {
        const blockerUnit = blockerPlayer?.field?.find((u: any) => u.unitId === blockerId);
        if (blockerUnit) {
          const isBulwark = isBulwarkType(blockerUnit, context.components);
          const metadata: MoveUnitMetadata = {
            cause: { type: "effect", command: "judgeDamage", actionId: "action.damageJudge" },
            combatSnapshot: { role: "blocker", blocksUnitId: combat.attackerUnitId },
            characterType: isBulwark ? "bulwark" : "soldier",
          };
          moveUnitToGraveyard(
            blockerUnit,
            combat.blockerPlayerKey,
            state,
            effectInterpreter,
            context,
            metadata
          );
        }
      }
    }

    // 1-5. 生存ブロッカーの battle cleanup
    if (combat.blockerPlayerKey) {
      const blockerPlayer = state.players[combat.blockerPlayerKey];
      for (const blockerId of combat.blockerUnitIds) {
        if (!combat.blockersMovedToGrave.includes(blockerId)) {
          const survivorBlocker = blockerPlayer?.field?.find((u: any) => u.unitId === blockerId);
          if (survivorBlocker && survivorBlocker.battle) {
            delete survivorBlocker.battle;
          }
        }
      }
    }
  }

  // 2. Orphan Blockers の battle cleanup
  for (const orphan of result.orphanBlockerUnitIds) {
    const player = state.players[orphan.blockerPlayerKey];
    const unit = player?.field?.find((u: any) => u.unitId === orphan.blockerUnitId);
    if (unit && unit.battle) {
      delete unit.battle;
    }
  }
}
