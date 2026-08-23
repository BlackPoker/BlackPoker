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
  readonly directDamageAmount?: number;
  /** @deprecated directDamageAmount を使用してください */
  readonly directDamageDealt?: number;
  readonly targetPlayerKey?: string;
  readonly bulwarkRevealed?: boolean;
  readonly bulwarkMatched?: boolean;
  readonly ruleVariant?: "normal" | "revolution";
  readonly differenceDamage?: { readonly amount: number; readonly targetPlayerKey: string };
  readonly attackerCharacterType?: string;
}

export interface DamageJudgeResult {
  readonly combats: readonly CombatResult[];
  readonly orphanBlockerUnitIds: readonly { blockerUnitId: string; blockerPlayerKey: string }[];
}
