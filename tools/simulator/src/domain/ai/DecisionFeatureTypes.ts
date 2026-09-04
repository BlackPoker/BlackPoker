/**
 * Decision Feature Schema Version (Version 1)
 */
export const FEATURE_SCHEMA_VERSION = 1;

/**
 * Ordered list of Context Feature names (Version 1)
 */
export const CONTEXT_FEATURE_NAMES = [
  // 1. Decision Source
  "source_is_action_request",
  "source_is_effect_resolution",

  // 2. Turn / Chance (Viewer Relative)
  "self_is_turn_player",
  "self_is_chance_player",
  "opponent_is_turn_player",
  "opponent_is_chance_player",

  // 3. Stage
  "stage_depth",

  // 4. Legal Pattern Counts
  "legal_pattern_count",
  "legal_action_pattern_count",
  "legal_pass_pattern_count",
  "legal_effect_selection_pattern_count",

  // 5. Self (Viewer Relative)
  "self_life_count",
  "self_hand_count",
  "self_field_count",
  "self_fog_count",
  "self_trump_count",
  "self_grave_count",

  // 6. Opponent (Viewer Relative - Secret-Safe)
  "opponent_life_known",
  "opponent_life_visible_count",
  "opponent_life_is_10plus",
  "opponent_hand_count",
  "opponent_field_count",
  "opponent_fog_count",
  "opponent_trump_count",
  "opponent_grave_count",
] as const;

export type ContextFeatureName = (typeof CONTEXT_FEATURE_NAMES)[number];
export const CONTEXT_FEATURE_DIMENSION = CONTEXT_FEATURE_NAMES.length;

/**
 * Ordered list of Pattern Feature names (Version 1)
 */
export const PATTERN_FEATURE_NAMES = [
  // 1. Pattern Kind
  "pattern_is_action",
  "pattern_is_pass",
  "pattern_is_effect_selection",
  "pattern_is_other",

  // 2. Action Metadata
  "has_action",
  "action_speed_normal",
  "action_speed_immediate",
  "action_speed_other",
  "action_timing_main",
  "action_timing_quick",
  "action_timing_block",
  "action_timing_damage_judge",
  "action_timing_other",

  // 3. Cost Payment
  "has_cost",
  "cost_discard_count",
  "cost_driven_bulwark_count",
  "cost_sacrificed_unit_count",
  "cost_life_count",

  // 4. Key Card Selection
  "has_key_card",
  "key_card_count",
  "key_card_known_count",
  "key_card_value_sum",
  "key_card_value_max",
  "key_card_spade_count",
  "key_card_heart_count",
  "key_card_diamond_count",
  "key_card_club_count",

  // 5. Key Unit Selection
  "has_key_unit",
  "key_unit_count",
  "selected_unit_size_sum",
  "selected_unit_size_max",
  "selected_unit_charge_count",
  "selected_unit_drive_count",
  "selected_unit_face_up_count",
  "selected_unit_face_down_count",

  // 6. Target Selection
  "has_target",
  "target_is_player",
  "target_is_unit",
  "target_is_request",
  "target_is_none",
  "target_is_other",
  "target_is_self",
  "target_is_opponent",
  "target_unit_size",
  "target_unit_is_charge",
  "target_unit_is_drive",
  "target_unit_face_up",
  "target_unit_face_down",

  // 7. Effect Selection
  "has_effect_selection",
  "effect_type_unit",
  "effect_type_unit_assignment",
  "effect_type_other",
  "effect_selected_value_count",
  "effect_assignment_count",
  "effect_assigned_unit_total",

  // 8. Order Selection
  "has_order_selection",
  "ordered_item_count",
] as const;

export type PatternFeatureName = (typeof PATTERN_FEATURE_NAMES)[number];
export const PATTERN_FEATURE_DIMENSION = PATTERN_FEATURE_NAMES.length;

/**
 * 盤面・文脈特徴量コンテナ
 */
export interface DecisionContextFeatures {
  readonly featureNames: readonly string[];
  readonly values: readonly number[];
}

/**
 * 単一の合法パターン特徴量コンテナ
 */
export interface DecisionPatternFeatures {
  /** 元の DecisionRequest.patterns におけるインデックス */
  readonly patternRef: number;
  /** パターンの種別 */
  readonly kind: string;
  /** デバッグ・分析用 Logical Pattern Key (メタデータ) */
  readonly logicalPatternKey?: string;
  /** 数値特徴量ベクトル (長さ: PATTERN_FEATURE_DIMENSION) */
  readonly values: readonly number[];
}

/**
 * DecisionFeatureEncoder が出力する完全なエンコード結果
 */
export interface EncodedDecisionFeatures {
  readonly featureSchemaVersion: number;
  readonly context: DecisionContextFeatures;
  readonly patterns: readonly DecisionPatternFeatures[];
}
