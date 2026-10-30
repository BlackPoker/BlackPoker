# BlackPoker Simulator AI Feature Schema v6 & Semantic Diagnostic v2 実装完了報告書 (R1)

- **Work ID**: `BP-SIM-AI-V92-FEATURE-SCHEMA-V6-IMPL-V1-R1`
- **対象ブランチ**: `BlackPoker/issue551-core-flow`
- **基準設計**: `BP-SIM-AI-V92-FEATURE-SCHEMA-V6-DESIGN-V1-R2` (Accepted SHA: `16abecd28542bc607bacc64961360f8b70a13125`)
- **コアフロー**: 第9.2版
- **ステータス**: **READY FOR INDEPENDENT REVIEW** (独立レビュー待ち)

---

## 1. 実装概要

第9.2版コアフローにおける `focusPlayer` の導入に対応し、AI特徴量表現（Feature Schema v6）および意味論的診断器（Semantic Diagnostic v2）の実装を完了しました。
本 R1 改訂では、独立レビューにおける指摘事項（テスト証拠・変更範囲・報告書整合性）に基づき、Test 9（Tie-Break 契約）・Test 16（スケーリング不変性）・Test 19（OFF/ON 完全論理トレース・正規化ログ比較）の受入テスト強化、および Regulation テスト10ファイルの差分監査と報告書記載の厳密化を行いました。

### 1.1 主な構成要素

1. **Feature Schema v6 導入 (`DecisionFeatureTypes.ts`, `DecisionFeatureEncoder.ts`)**:
   - `FEATURE_SCHEMA_VERSION = 6`
   - Context 特徴量末尾に `self_is_focus_player` (Index 163) および `opponent_is_focus_player` (Index 164) を追加。
   - Context 次元数: 163 $\to$ 165
   - Pattern 次元数: 143 (不変)
   - 合計特徴量数: 306 $\to$ 308
   - `PlayerObservation.focusPlayerId` から合法的に抽出し、自他視点鏡像対称性および不正ID時のFail-Closed（(0, 0)）を実装。

2. **Canonical Scaling Registry v6 (`DecisionFeatureScalingRegistry.ts`, `ai-v92-feature-schema-v6-registry-v1.json`)**:
   - `FEATURE_SCALING_SCHEMA_VERSION = 6`
   - 新規 Context 特徴量 163, 164 に対し `BOOLEAN` / `identity` スケーリング（出力域 `[0, 1]`）を登録。
   - 既存 306 特徴量のスケーリングパラメータ・出力域・クラスは 100% 完全維持。

3. **旧 v5 DNA 検証器とランタイム拒絶 (`DecisionDNALegacyValidator.ts`, `DecisionDNACodec.ts`)**:
   - `DecisionDNALegacyValidator.validateV5` を新設し、旧形式（163/143/23,452重み）を厳格にバリデーション。
   - `DecisionDNACodec.validate` は `featureSchemaVersion !== 6` の DNA を即座に例外 `DecisionDNAValidationError` で拒絶（Fail-Closed）。

4. **決定論的 DNA 移行関数 (`DecisionDNAMigration.ts`)**:
   - `DecisionDNAMigration.migrateV5toV6`:
     - Pattern 重み（143要素）の厳密複製
     - 行 0..162（23,309要素）の Row-major 完全複製
     - 行 163, 164（286要素）の厳密な `0.0` 初期化
     - 静的プロヴナンス（`migratedFromSchema: 5`, `migrationRule: "v5-to-v6-zero-init-v1"`）の付与（動的タイムスタンプ完全排除）
   - これにより、v5 DNA と移行後 v6 DNA において全候補手のスコアが IEEE 754 浮動小数点演算で bit-exact（$\Delta \text{Score} = 0.0$）に一致。

5. **タイブレーク契約の整合化 (`GenomePolicy.ts`)**:
   - コード実装（`if (p.score > bestScore)` による更新・同点時不更新）と整合するよう、仕様コメントを「最初に出現した最高スコア手 (first-encountered maximum-score pattern) 優先」に明記。

6. **Semantic Diagnostic v2 移行 (`SemanticDiagnosticTypes.ts`, `SemanticFingerprintCalculator.ts`, `SemanticStallCycleDetector.ts`, `ai-semantic-fingerprint-field-registry-v2-r1.json`)**:
   - `SemanticDiagnosticResult.semanticDiagnosticVersion: 2`
   - フィンガープリントプレフィックス: `pof2-`, `drsf2-`, `gpif2-`
   - `focusPlayerId` に対する感度を付与。
   - 受動的診断不変性（OFF vs ON での 100% byte-identical パリティ）を完全維持。
   - 新規レジストリ `docs/ai-semantic-fingerprint-field-registry-v2-r1.json` を新設（Accepted R8 レジストリは履歴として完全凍結）。

---

## 2. 受入テスト検証結果 (`v92FeatureSchemaV6Acceptance.test.ts`)

Design R2 第9項で策定された 20 項目の受入テストを実装し、全項目が PASS することを確認しました：

| # | テストタイトル | 実際の検証・アサーション内容 | 結果 |
|---|---|---|:---:|
| 1 | `Test 1: v5 Legacy Validation` | `DecisionDNALegacyValidator.validateV5` が正常な旧 v5 DNA（163/143/23,452重み）を検証エラーなく PASS すること | **PASS** |
| 2 | `Test 2: v5 Direct Runtime Rejection` | `DecisionDNACodec.validate` に未移行 v5 DNA を直接渡すと `DecisionDNAValidationError` が送出され、エラー理由に `featureSchemaVersion` が含まれること | **PASS** |
| 3 | `Test 3: v5 -> v6 Deterministic Migration` | 同一 v5 DNA から 2 回移行した結果のオブジェクト（`toEqual`）および JSON 文字列が 100% bit-exact に一致し、移行後 DNA が `DecisionDNACodec.validate` を PASS すること | **PASS** |
| 4 | `Test 4: DNA Metadata Preservation` | 既存メタデータ（id, name, generation, fitness）を保持し、決定論的静的プロヴナンス（`migratedFromSchema: 5`, `migrationRule: "v5-to-v6-zero-init-v1"`）のみが付与されること | **PASS** |
| 5 | `Test 5: Full Weight Exact Equality` | Pattern 重み（143要素）および相互作用重み行 0..162（23,309要素）が v5 DNA と 100% 一致（`===`）すること | **PASS** |
| 6 | `Test 6: Row-Major Mapping` | 行 $c$ ($0 \le c < 163$)、列 $p$ ($0 \le p < 143$) に対し、オフセット $c \times 143 + p$ の重みが v5 と一致すること | **PASS** |
| 7 | `Test 7: Zero Initialized Rows` | 行 163 および 164 の全 286 重みが厳密に `0.0` であること | **PASS** |
| 8 | `Test 8: All-Pattern Scoring Parity` | 実戦 DecisionRequest の全合法候補手に対し、v5 DNA と移行後 v6 DNA のスコアが実 JavaScript 浮動小数点演算で完全一致（`===`）すること | **PASS** |
| 9 | `Test 9: Argmax / First-Encountered Tie-Break Parity` | スコア同点時の第一遭遇手選択（first-encountered maximum-score pattern）契約を検証：<br>① 明示候補順 `[7, 2]`（スコア0.0）で先に出現した `patternRef = 7` が選択される（`selectedPatternRef === 7`）<br>② 候補順逆転 `[2, 7]`（スコア0.0）で先に出現した `patternRef = 2` が選択される（`selectedPatternRef === 2`）<br>③ 標準 `LegalPattern` 配列 `[patA, patB]` で先頭インデックス 0（patA）が選択される<br>④ 逆転 `[patB, patA]` で先頭インデックス 0（patB）が選択される | **PASS** |
| 10 | `Test 10: Focus Self / Opponent / System Activation` | `obs.focusPlayerId` が自プレイヤー時は (1, 0)、相手プレイヤー時は (0, 1) となり、`chancePlayer === "system"` 下でも正しく機能すること | **PASS** |
| 11 | `Test 11: Focus Missing / Invalid Fail-Closed` | `focusPlayerId` が `undefined`、不正文字列 `"invalid"`、またはシステム `"system"` の場合、(0, 0) となり相手フォーカスと誤認しないこと | **PASS** |
| 12 | `Test 12: Seat Swap Symmetry` | p1 視点と p2 視点でフォーカス特徴量が鏡像反転すること（p1フォーカス時: p1視点(1, 0), p2視点(0, 1)） | **PASS** |
| 13 | `Test 13: Registry 308 Entries` | Canonical Registry JSON に `schemaVersion: 6`, `totalFeatures: 308`, `contextFeatures: 165`, `patternFeatures: 143` が過不足なく登録されていること | **PASS** |
| 14 | `Test 14: Registry Compatibility Fields` | 既存 306 項目に `Valid for FEATURE_SCHEMA_VERSION >= 5 (including Schema v6)`、新規 163/164 項目に `Introduced in FEATURE_SCHEMA_VERSION = 6` が設定されていること | **PASS** |
| 15 | `Test 15: Identity Scaling` | 特徴量 163, 164 のスケーリング定義が `BOOLEAN` / `identity` / `[0, 1]` であり、実際に Identity スケーリングを行うこと | **PASS** |
| 16 | `Test 16: Old 306 Scaling Rules Unchanged` | 既存 306 特徴量（Context 163, Pattern 143）について、v6 JSON レジストリおよびランタイム TypeScript 規則（`CONTEXT_SCALING_RULES`, `PATTERN_SCALING_RULES`）の双方が v5 レジストリと完全一致すること | **PASS** |
| 17 | `Test 17: pof2 / drsf2 / gpif2 Focus Sensitivity` | `focusPlayer` のみが変化したとき、`pof2`, `drsf2`, `gpif2` が確実に変化し、プレフィックスが正しいこと | **PASS** |
| 18 | `Test 18: Diagnostic Output Versioning` | 診断実行結果のバージョンが `2` であり、全トレースが `pof2-`, `drsf2-`, `gpif2-` を含むこと | **PASS** |
| 19 | `Test 19: Diagnostic OFF/ON Parity` | 同一 matchId・同一 seed・同一 DNA で fresh session を生成し、診断無効時と有効時で比較：<br>① 勝敗・手数・最終ハッシュ（`completed`, `winner`, `reason`, `totalDecisions`, `turnCount`, `finalStateHash`）の一致<br>② Decision Trace 全件の論理系列（`stepCount`, `logicalDecisionId`, `playerId`, `stateVersion`, `stateHash`, `selectedPatternRef`, `selectedLogicalPatternKey`, `selectedPatternKind`, `actionId`）の一致<br>③ 非決定論的実行時項目（`timestamp`, `decisionId`）を除外した正規化 Match Log の完全一致 | **PASS** |
| 20 | `Test 20: Same-Seed Match Determinism` | 同一シード対戦再実行で、全意思決定トレースの論理識別子・手・状態ハッシュ・フィンガープリント系列が 100% 一致すること | **PASS** |

---

## 3. 実装上の技術的決定と仕様整合性エビデンス

### 3.1 Test 9: Tie-Break 契約と実 API 仕様の照合

1. **実 API 仕様**:
   - `src/domain/decision/LegalPattern.ts` の公式型定義には `patternRef` フィールドは定義されておらず、`patternId`, `kind`, `actionSelectionRef` 等が定義されています。
   - `DecisionFeatureEncoder.encodePatterns()` において、`patternRef: (p as any).patternRef ?? i`（$i$ は配列インデックス）として各候補の `patternRef` が決定論的に付与されます。
   - 通常のシミュレーター対戦実行時（`GameSession` 生成の `DecisionRequest`）では `LegalPattern` はインデックス $0, 1, \dots$ で参照され、`SimulationRunner` 側でも `step.request.patterns[response.selectedPatternRef]` としてインデックス解決されます。
2. **設計書 `[7, 2]` 例との整合性**:
   - 設計書における `[7, 2]` の例示は「候補順として 7 が先、2 が後に出現した同点時」を意味しています。
   - 合成フィクスチャにおいて `(p as any).patternRef = 7` および `(p as any).patternRef = 2` を明示付与した場合、`DecisionFeatureEncoder` はこれをそのまま保持し、`GenomePolicy.choose()` は `if (p.score > bestScore)` に従い最初に出現した `patternRef = 7` を厳格に返します（`selectedPatternRef === 7`）。
   - 逆に候補順を `[2, 7]` に逆転させた場合、先に出現した `patternRef = 2` が厳格に選択されます（`selectedPatternRef === 2`）。
   - さらに標準の配列インデックス参照（`patternRef` プロパティなし）においても、候補順 `[patA, patB]` では index 0（patA）、`[patB, patA]` では index 0（patB）が選択されます。
   - これにより、`min(patternRef)` ではなく厳格に **「最初に出現した最高スコア手 (first-encountered maximum-score pattern)」** が選択される契約が実 API 上で完全に立証されました。

### 3.2 Test 19: Diagnostic OFF/ON 完全論理パリティ

- `enableSemanticDiagnostics: false` (OFF) と `enableSemanticDiagnostics: true` (ON) において、ゲーム状態更新および意思決定選択に一切の干渉が生じないことを実証しました。
- 比較対象：
  - 高レベル勝敗結果: `completed` (true), `winner` ("p1"), `reason` ("SURRENDER"), `totalDecisions` (2), `turnCount` (1), `finalStateHash` ("sh2-b2353a479b1875e52a9254644a9fe10c")
  - 意思決定トレース: 全2ステップの `stepCount`, `logicalDecisionId`, `playerId`, `stateVersion`, `stateHash`, `selectedPatternRef`, `selectedLogicalPatternKey`, `selectedPatternKind`, `actionId` が全件完全一致
  - Canonical Match Log: 実行時の動的タイムスタンプ（`meta.startedAt`, `meta.finishedAt`, `event.timestamp`）および動的 `decisionId` を除外した正規化イベント系列が完全一致

---

## 4. Regulation テスト差分監査 (Scope Audit)

前回コミット（`df6f211dd`）において変更された `tools/simulator/src/tests/regulation/` 配下の10ファイルについて、差分スコープの厳密な監査を実施しました。

### 4.1 対象10ファイル一覧と差分内容

| # | ファイルパス | 変更内容 | 監査結果 |
|---|---|---|:---:|
| 1 | `tools/simulator/src/tests/regulation/graveTopFoundation.test.ts` | `FEATURE_SCHEMA_VERSION` (5 $\to$ 6), DNA 総重み (23452 $\to$ 23738) | **適合** (Schema追従のみ) |
| 2 | `tools/simulator/src/tests/regulation/searchActionFoundation.test.ts` | `encoded.featureSchemaVersion` (5 $\to$ 6), コメントの次元表記 (23452 $\to$ 23738) | **適合** (Schema追従のみ) |
| 3 | `tools/simulator/src/tests/regulation/standardAddBulwark.test.ts` | `FEATURE_SCHEMA_VERSION` (5 $\to$ 6), DNA 総重み (23452 $\to$ 23738) | **適合** (Schema追従のみ) |
| 4 | `tools/simulator/src/tests/regulation/standardDeathLance.test.ts` | `FEATURE_SCHEMA_VERSION` (5 $\to$ 6), DNA 総重み (23452 $\to$ 23738) | **適合** (Schema追従のみ) |
| 5 | `tools/simulator/src/tests/regulation/standardHandes.test.ts` | `FEATURE_SCHEMA_VERSION` (5 $\to$ 6), DNA 総重み (23452 $\to$ 23738) | **適合** (Schema追従のみ) |
| 6 | `tools/simulator/src/tests/regulation/standardHardening.test.ts` | `FEATURE_SCHEMA_VERSION` (5 $\to$ 6), DNA 総重み (23452 $\to$ 23738) | **適合** (Schema追従のみ) |
| 7 | `tools/simulator/src/tests/regulation/standardMagician.test.ts` | `FEATURE_SCHEMA_VERSION` (5 $\to$ 6), `DecisionFeatureEncoder.SCHEMA_VERSION` (5 $\to$ 6), `encoded.featureSchemaVersion` (5 $\to$ 6) | **適合** (Schema追従のみ) |
| 8 | `tools/simulator/src/tests/regulation/standardReanimate.test.ts` | `FEATURE_SCHEMA_VERSION` (5 $\to$ 6), DNA 総重み (23452 $\to$ 23738) | **適合** (Schema追従のみ) |
| 9 | `tools/simulator/src/tests/regulation/standardReanimateComponent.test.ts` | `FEATURE_SCHEMA_VERSION` (5 $\to$ 6), DNA 総重み (23452 $\to$ 23738) | **適合** (Schema追従のみ) |
| 10 | `tools/simulator/src/tests/regulation/standardReturn.test.ts` | `FEATURE_SCHEMA_VERSION` (5 $\to$ 6), DNA 総重み (23452 $\to$ 23738) | **適合** (Schema追従のみ) |

### 4.2 監査総括

- **AI Schema Version 追従のみ**: 定数期待値の 5 $\to$ 6 への更新のみ。
- **DNA Weight Count 追従のみ**: 次元数期待値の 23,452 $\to$ 23,738 への更新のみ。
- **Game Rules 変更なし**: ルールロジック、アクション効果、カード定義の変更は 0 件。
- **Core Flow 変更なし**: ステージ進行、パス判定、フェイズ移行等の変更は 0 件。
- **テストシナリオ意味論変更なし**: 各テストケースのセットアップ、アクション実行順、期待盤面状態に変更は 0 件。
- **テスト削除なし**: テストケースの削除・無効化（skip/todo等）は 0 件（全テストが実行され合格）。
- **無関係な修正**: 一切存在しないことを確認。本 R1 タスクにおける追加修正は禁止規則に従い 0 件（変更なし）。

---

## 5. 履歴互換性保護 (Historical Compatibility)

- **旧 v5 Evidence JSON の保護**: `reports/ai/v92-core-baseline-evidence-v1.json` は一切変更せず、**0 diff** を厳格に保持。
- **旧 R8 レジストリの保護**: `docs/ai-semantic-fingerprint-field-registry-v1-r8.json` は履歴資産として完全凍結し、**0 diff** を保持。
- **診断計算器の後方互換性**: `SemanticFingerprintCalculator` には旧ベースライン検証用の `computePof1`, `computeDrsf1`, `computeGpif1` を温存し、旧 Evidence との整合性検証（`v92CoreBaselineEvidence.test.ts`）を可能としています。プロダクション実行時は v2 メソッド（`computePof2`, `computeDrsf2`, `computeGpif2`）が使用されます。

---

## 6. プロダクション凍結検証 (Production Freeze)

以下の領域について、変更が一切加えられていない（**0 diff**）ことを確認しました：
- `src/engine/rules/**` / `src/domain/rules/**` (0 diff)
- `data/rules-vnext/**` (0 diff)
- `src/engine/session/GameSession.ts` (0 diff)
- `src/engine/simulation/SimulationRunner.ts` (0 diff)
- `src/engine/simulation/StateHasher.ts` (0 diff)
- `src/engine/ai/FitnessEvaluator.ts` (0 diff)
- `src/engine/ai/GeneticOperators.ts` (0 diff)
- `src/engine/ai/PopulationSelector.ts` (0 diff)
- `src/engine/ai/GenomePolicy.ts` の処理ロジック (0 diff)
- `src/engine/ai/DecisionFeatureEncoder.ts` (0 diff)
- `src/engine/ai/DecisionFeatureScaler.ts` (0 diff)
- `src/engine/ai/DecisionDNAMigration.ts` (0 diff)
- `src/engine/ai/SemanticFingerprintCalculator.ts` / `SemanticStallCycleDetector.ts` (0 diff)

---

## 7. 全体テストスイート検証結果

Docker コンテナ `bp-simulator` 内で実行：
- **テストファイル総数**: 206 ファイル
- **テスト総数**: 2,908 テスト
- **結果**: **206 passed (100%), 2,908 passed (100%)**
- **各種ランナー**:
  - `npm run build`: 成功（dist 0 diff 検証済み）
  - `npm run playable:check`: 成功
  - `npm run scenario:rules-vnext`: 成功（全8シナリオ完了）
  - `npm run compare:rules-vnext`: 成功
