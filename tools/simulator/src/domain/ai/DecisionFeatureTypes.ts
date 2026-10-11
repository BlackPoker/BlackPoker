/**
 * DecisionFeatureTypes.ts
 *
 * BlackPoker Simulator - AI Feature Schema v3
 *
 * 【設計原則】
 * 1. 汎用観測情報の完全網羅:
 *    AI プレイヤー本人がルール上合法的に観測可能で、意思決定に意味のある情報カテゴリを原則すべて Feature 化。
 *    盤面 Context に加え、現在解決している Request Context (Action Identity, Effect Step, Metadata) および
 *    Effect Selection の詳細選択内容 (Unit, Card, Assignment, Player, Coverage Ratio) を包含。
 * 2. 個別アクション戦略ハードコードの完全排除:
 *    特定アクション名 (action.down, action.up 等) に対する手動ルールや分岐を排除し、
 *    固定長 multi-hash (StableIdentityEncoder) および汎用メタデータによって表現。
 * 3. プライバシー境界の厳格な保護:
 *    相手手札の中身、相手裏向き防壁/切札、相手 Life 10枚以上時の正確な枚数、未開封パックの中身などの
 *    観測不能な秘密情報は一切特徴量へ含めない。
 * 4. 固定長・順序非依存・決定論的:
 *    特徴量次元数・順序は不変であり、同一観測情報に対して完全に決定論的な数値を返します。
 */

/**
 * Decision Feature Schema Version (Version 3)
 */
export const FEATURE_SCHEMA_VERSION = 3;

/**
 * Ordered list of Context Feature names (Version 3)
 */
export const CONTEXT_FEATURE_NAMES = [
  // 1. Decision Context (Viewer Relative) (8)
  "source_is_action_request",
  "source_is_effect_resolution",
  "self_is_turn_player",
  "self_is_chance_player",
  "opponent_is_turn_player",
  "opponent_is_chance_player",
  "turn_count",
  "stage_depth",

  // 2. Legal Pattern Counts & Actionability (11)
  "legal_pattern_count",
  "legal_action_pattern_count",
  "legal_pass_pattern_count",
  "legal_effect_selection_pattern_count",
  "legal_non_pass_pattern_count",
  "legal_action_speed_normal_count",
  "legal_action_speed_immediate_count",
  "legal_action_timing_main_count",
  "legal_action_timing_quick_count",
  "legal_action_timing_block_count",
  "legal_action_timing_damage_judge_count",

  // 3. Self - Life & Hand (18)
  "self_life_count",
  "self_hand_count",
  "self_hand_known_count",
  "self_hand_spade_count",
  "self_hand_heart_count",
  "self_hand_diamond_count",
  "self_hand_club_count",
  "self_hand_joker_count",
  "self_hand_numeric_count",
  "self_hand_ace_count",
  "self_hand_jack_count",
  "self_hand_queen_count",
  "self_hand_king_count",
  "self_hand_value_sum",
  "self_hand_value_max",
  "self_hand_value_min",
  "self_hand_pair_rank_count",
  "self_hand_max_rank_multiplicity",

  // 4. Self - Field & Components (9)
  "self_field_count",
  "self_field_charge_count",
  "self_field_drive_count",
  "self_field_face_up_count",
  "self_field_face_down_count",
  "self_field_size_sum",
  "self_field_size_max",
  "self_field_attacker_count",
  "self_field_blocker_count",

  // 5. Self - Fog, Trump, Grave, Pack, Rare (18)
  "self_fog_count",
  "self_fog_card_known_count",
  "self_trump_count",
  "self_trump_charge_count",
  "self_trump_drive_count",
  "self_trump_size_sum",
  "self_grave_count",
  "self_grave_top_card_known",
  "self_grave_top_card_value",
  "self_grave_top_card_is_joker",
  "self_pack_count",
  "self_pack_opened",
  "self_pack_can_view_cards",
  "self_pack_known_card_count",
  "self_pack_known_value_sum",
  "self_rare_count",
  "self_rare_can_view_cards",
  "self_rare_known_card_count",

  // 6. Opponent - Observable Information (Secret-Safe) (26)
  "opponent_life_known",
  "opponent_life_visible_count",
  "opponent_life_is_10plus",
  "opponent_hand_count",
  "opponent_field_count",
  "opponent_field_charge_count",
  "opponent_field_drive_count",
  "opponent_field_face_up_count",
  "opponent_field_face_down_count",
  "opponent_field_size_sum",
  "opponent_field_size_max",
  "opponent_field_attacker_count",
  "opponent_field_blocker_count",
  "opponent_fog_count",
  "opponent_fog_card_known_count",
  "opponent_trump_count",
  "opponent_trump_charge_count",
  "opponent_trump_drive_count",
  "opponent_trump_size_sum",
  "opponent_grave_count",
  "opponent_grave_top_card_known",
  "opponent_grave_top_card_value",
  "opponent_grave_top_card_is_joker",
  "opponent_pack_count",
  "opponent_pack_opened",
  "opponent_rare_count",

  // 7. Relative State (Viewer Relative Deltas) (10)
  "relative_hand_count",
  "relative_field_count",
  "relative_field_size_sum",
  "relative_fog_count",
  "relative_grave_count",
  "relative_pack_count",
  "relative_rare_count",
  "relative_trump_count",
  "relative_life_known",
  "relative_life_count",

  // 8. Request Context (Viewer Relative) (63)
  // 8.1 Source Request Existence & Controller Relation (6)
  "request_has_source",
  "request_source_is_action",
  "request_source_is_effect",
  "request_source_is_zone_top",
  "request_source_controller_is_self",
  "request_source_controller_is_opponent",

  // 8.2 Source Action Stable Identity (16 buckets)
  "request_action_bucket_0",
  "request_action_bucket_1",
  "request_action_bucket_2",
  "request_action_bucket_3",
  "request_action_bucket_4",
  "request_action_bucket_5",
  "request_action_bucket_6",
  "request_action_bucket_7",
  "request_action_bucket_8",
  "request_action_bucket_9",
  "request_action_bucket_10",
  "request_action_bucket_11",
  "request_action_bucket_12",
  "request_action_bucket_13",
  "request_action_bucket_14",
  "request_action_bucket_15",

  // 8.3 Source Effect Step Stable Identity (16 buckets)
  "request_effect_step_bucket_0",
  "request_effect_step_bucket_1",
  "request_effect_step_bucket_2",
  "request_effect_step_bucket_3",
  "request_effect_step_bucket_4",
  "request_effect_step_bucket_5",
  "request_effect_step_bucket_6",
  "request_effect_step_bucket_7",
  "request_effect_step_bucket_8",
  "request_effect_step_bucket_9",
  "request_effect_step_bucket_10",
  "request_effect_step_bucket_11",
  "request_effect_step_bucket_12",
  "request_effect_step_bucket_13",
  "request_effect_step_bucket_14",
  "request_effect_step_bucket_15",

  // 8.4 Source Action Metadata (8)
  "request_action_speed_normal",
  "request_action_speed_immediate",
  "request_action_speed_other",
  "request_action_timing_main",
  "request_action_timing_quick",
  "request_action_timing_block",
  "request_action_timing_damage_judge",
  "request_action_timing_other",

  // 8.5 Source Request Visible Key Card Aggregate (5)
  "request_key_card_count",
  "request_key_card_known_count",
  "request_key_card_value_sum",
  "request_key_card_value_max",
  "request_key_card_value_min",

  // 8.6 Source Request Target Semantics (12)
  "request_target_is_player",
  "request_target_is_unit",
  "request_target_is_request",
  "request_target_is_none",
  "request_target_is_other",
  "request_target_is_self",
  "request_target_is_opponent",
  "request_target_unit_size",
  "request_target_unit_is_charge",
  "request_target_unit_is_drive",
  "request_target_unit_face_up",
  "request_target_unit_face_down",
] as const;

export type ContextFeatureName = (typeof CONTEXT_FEATURE_NAMES)[number];
export const CONTEXT_FEATURE_DIMENSION = CONTEXT_FEATURE_NAMES.length;

/**
 * Ordered list of Pattern Feature names (Version 3)
 */
export const PATTERN_FEATURE_NAMES = [
  // 1. Pattern Kind (4)
  "pattern_is_action",
  "pattern_is_pass",
  "pattern_is_effect_selection",
  "pattern_is_other",

  // 2. Action Metadata (9)
  "has_action",
  "action_speed_normal",
  "action_speed_immediate",
  "action_speed_other",
  "action_timing_main",
  "action_timing_quick",
  "action_timing_block",
  "action_timing_damage_judge",
  "action_timing_other",

  // 3. Cost Payment (6)
  "has_cost",
  "cost_discard_count",
  "cost_driven_bulwark_count",
  "cost_sacrificed_unit_count",
  "cost_life_count",
  "cost_total_item_count",

  // 4. Key Card Selection (11)
  "has_key_card",
  "key_card_count",
  "key_card_known_count",
  "key_card_value_sum",
  "key_card_value_max",
  "key_card_value_min",
  "key_card_spade_count",
  "key_card_heart_count",
  "key_card_diamond_count",
  "key_card_club_count",
  "key_card_joker_count",

  // 5. Key Unit Selection (8)
  "has_key_unit",
  "key_unit_count",
  "selected_unit_size_sum",
  "selected_unit_size_max",
  "selected_unit_charge_count",
  "selected_unit_drive_count",
  "selected_unit_face_up_count",
  "selected_unit_face_down_count",

  // 6. Target Selection (13)
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

  // 7. Effect Selection - Base Metadata (7)
  "has_effect_selection",
  "effect_type_unit",
  "effect_type_unit_assignment",
  "effect_type_other",
  "effect_selected_value_count",
  "effect_assignment_count",
  "effect_assigned_unit_total",

  // 8. Generic Effect Selection - Unit Aggregate (12)
  "effect_selected_unit_count",
  "effect_selected_self_unit_count",
  "effect_selected_opponent_unit_count",
  "effect_selected_unit_charge_count",
  "effect_selected_unit_drive_count",
  "effect_selected_unit_face_up_count",
  "effect_selected_unit_face_down_count",
  "effect_selected_unit_size_sum",
  "effect_selected_unit_size_max",
  "effect_selected_unit_size_min",
  "effect_selected_unit_attacker_count",
  "effect_selected_unit_blocker_count",

  // 9. Generic Effect Selection - Card Aggregate (17)
  "effect_selected_card_count",
  "effect_selected_card_known_count",
  "effect_selected_card_spade_count",
  "effect_selected_card_heart_count",
  "effect_selected_card_diamond_count",
  "effect_selected_card_club_count",
  "effect_selected_card_joker_count",
  "effect_selected_card_numeric_count",
  "effect_selected_card_ace_count",
  "effect_selected_card_jack_count",
  "effect_selected_card_queen_count",
  "effect_selected_card_king_count",
  "effect_selected_card_value_sum",
  "effect_selected_card_value_max",
  "effect_selected_card_value_min",
  "effect_selected_card_pair_rank_count",
  "effect_selected_card_max_rank_multiplicity",

  // 10. Generic Effect Selection - Player / Request Semantics (6)
  "effect_selected_player_count",
  "effect_selected_player_is_self",
  "effect_selected_player_is_opponent",
  "effect_selected_request_count",
  "effect_selected_request_is_self",
  "effect_selected_request_is_opponent",

  // 11. Generic Effect Selection - Unit Assignment Semantics (13)
  "effect_assignment_source_count",
  "effect_assignment_selected_count",
  "effect_assignment_source_size_sum",
  "effect_assignment_source_size_max",
  "effect_assignment_source_size_min",
  "effect_assignment_selected_size_sum",
  "effect_assignment_selected_size_max",
  "effect_assignment_selected_size_min",
  "effect_assignment_size_delta_sum",
  "effect_assignment_positive_delta_count",
  "effect_assignment_negative_delta_count",
  "effect_assignment_self_to_opp_count",
  "effect_assignment_opp_to_self_count",

  // 12. Generic Effect Selection - Coverage Ratio (3)
  "effect_selection_candidate_count",
  "effect_selection_selected_count",
  "effect_selection_coverage_ratio",

  // 13. Order Selection (2)
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
