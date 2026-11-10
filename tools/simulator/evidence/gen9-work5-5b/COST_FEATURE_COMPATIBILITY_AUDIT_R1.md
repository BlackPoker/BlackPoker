# Gen 9 Work 5-5B R1/R2: コスト支払い特徴量実装の互換性監査・回帰修正・CI正常化レポート

- **Work ID:** `BP-SIM-AI-GEN9-WORK55B-R2-PARITY-TEST-CI-FIX`
- **対象リポジトリ:** `BlackPoker/BlackPoker`
- **対象ブランチ:** `BlackPoker/issue551-core-flow`
- **作業開始基準 HEAD (R2):** `9ee2c54c829db305d102ad4e31a311107f9edbf8`
- **新特徴量追加前基準コミット:** `efe071f65ef37ec2a5bd6670ec52aaa3cd4d33a8`
- **検証日:** 2026-11-10

---

## 1. エグゼクティブサマリ

Work 5-5B で実装された 4 つのコスト支払い戦術特徴量（t20〜t23）に関して、R1 での互換性修正に続き、R2 では以下の最優先課題および独立パリティ検証基盤の健全化を完了した：

1. **最優先: CI TypeScript 型エラー 13 件の完全解消**
   - CI の `Build Simulator`（`tsc && vite build`）が失敗していた原因である `gen9IndependentGoldenParity.test.ts` の型エラー 13 件を、正本データモデル（`DecisionRequest`, `DecisionCatalog`, `LegalPattern`）に準拠して完全修正。`as any` や `@ts-ignore` を使用せず、静的型検査を 0 エラーで通過。
2. **修正A: 通常ブロックの Golden Fixture の正規化 (Scenario 6)**
   - 非公式な `kind: "BLOCK"` や未定義の `blockAssignments` を廃止し、BlackPoker の正式な `LegalPatternKind`（`"EFFECT_SELECTION"`）および `selectionType: "unitAssignment"`、`EffectSelection.assignments` に基づく生成へ移行。`LegalPatternGenerator.generateBlockAssignmentDecision()` により、ブロック特徴量（t14〜t16）が実際に計算される局面での完全一致を検証。
3. **修正B: ストリーミングブロックの Golden Fixture の本物化 (Scenario 7)**
   - 同一局面から通常列挙（Method A: `maxFullPatternLimit: Infinity`）と本物のストリーミング列挙（Method B: `maxFullPatternLimit: 0`）を生成し、以下の 4 経路すべてにおいて完全一致（差分 1e-12 以下、UnitAssignment 一致）することを検証：
     - ① 旧Policy: 通常列挙
     - ② 新Policy: 通常列挙
     - ③ 旧Policy: ストリーミング列挙
     - ④ 新Policy: ストリーミング列挙
4. **修正C: 最高スコア同点のタイブレーク検証 (Scenario 8)**
   - 最高スコアを持つ合法手が 2 件以上存在する局面（同一アクション・最高スコア同点）を正式に構築し、最小 patternRef（0）優先の決定論的タイブレーク、候補順序反転耐性、および `choose()` と `evaluatePatterns()` の選択一致を完全検証。
5. **修正D: Golden Fixture の不変性（テスト時上書き防止）**
   - テストファイル内の `fs.writeFileSync` を完全撤廃。独立した生成スクリプト（`generateGoldenParityFixture.ts`）と、読み取り専用のテスト検証（`gen9IndependentGoldenParity.test.ts`）に分離。通常テスト実行前後で Golden Fixture（`golden_parity_fixture_r2.json`）の SHA-256 が 100% 不変であることを実証。
6. **Scenario 10 正本ベンチマーク重み適用**
   - 架空の重みを廃止し、`src/engine/ai/Gen9BenchmarkWeights.ts` の `G0_IND7_WEIGHTS` および `G3_IND3_WEIGHTS` 正本重みを適用。

---

## 2. R1 重点修正項目の実績（保持履歴）

### 2.1 修正A: Gen9 R4 Prototype の PASS ペナルティ免除の回帰修正
- **原因:** `Gen9TacticalPrototypePolicy.ts` 内で `this.encoderVersion === "v7.2-unified-block-conditional-pass"` がハードコードされており、デフォルトが `v7.3-cost-evaluated-v24` になった際に判定が `false` となり、有効な対抗手段がない場合の PASS 減点免除が無効化されていた。
- **対処:** `supportsConditionalPass(this.encoderVersion)` へ統一。v7.2 および v7.3（デフォルト）の双方で免除が機能するように修正。PA-1〜PA-6 テストを追加し、全通過を確認。

### 2.2 修正B: コスト参照IDの解決失敗の確実な検出（3状態区分）
- カード参照状態を `KNOWN`（公開・評価対象）、`HIDDEN`（伏せカード・推測チート禁止で 0.0 スキップ）、`INVALID_REFERENCE`（観測外の不正ID・診断検知し 0.0 フェイルクローズ）に厳格区分。
- 不正 ID を `TacticalCostEvaluationContext`（`invalidCardReferenceIds`, `invalidUnitReferenceIds`, `invalidCostPaymentRefs`）に記録し、Joker 誤認やサイレント推測を排除。

### 2.3 修正C: DNA に含まれる Encoder Version の厳密な検証
- `VALID_TACTICAL_FEATURE_ENCODER_VERSIONS` を定義し、DNA notes 内に未知バージョンが指定された場合は明示的に例外をスローして拒否。
- `encoderVersion` 省略時の旧 20 次元 DNA は `v7.2` として安全に復元し、末尾 4 つゼロ重みの 24 次元へ拡張。

---

## 3. R2 修正項目の詳細報告

### 3.1 CI 型エラー 13 件の原因と修正内容

CI（GitHub Actions run 42750579281）で発生したビルドエラーの原因と対応：

| 対象行（修正前） | エラー内容 | 原因 | 修正内容 |
| :--- | :--- | :--- | :--- |
| 行 141〜143 | TS2741 | `CardSelection.displayCodes` 不足 | `displayCodes: ["S7"]` 等の正規表示コードを設定 |
| 行 146 | TS2741 | `UnitSelection.displayNames` 不足 | `displayNames: ["Soldier 1"]` 等の正規表示名を設定 |
| 行 162, 723 | TS2561 | `unitSelectionRef` は LegalPattern に存在しない | 正式な参照プロパティ `keyUnitSelectionRef` に修正 |
| 行 516, 611 | TS2353 | `DecisionCatalog.blockAssignments` は存在しない | 正式なカタログプロパティ `effectSelections` を使用 |
| 行 522, 618〜619 | TS2322 | `kind: "BLOCK"` は未定義 | 正式な種別 `kind: "EFFECT_SELECTION"` に修正 |
| 行 691〜692 | TS2741 | `CardSelection.displayCodes` 不足 | `displayCodes: ["JOKER"]`, `["S5"]` を設定 |

`as any` や `@ts-ignore` に頼ることなく、正式な TypeScript インターフェースに従って型チェックを 0 エラーで通過させた。

### 3.2 修正A: 通常ブロックの Golden Fixture (Scenario 6)
- **形式:** `kind: "EFFECT_SELECTION"`, `effectSelectionRef: 0`, `selectionType: "unitAssignment"`, `catalog.effectSelections[0].assignments: [...]`
- **生成手法:** `LegalPatternGenerator.generateBlockAssignmentDecision()` に `{ maxFullPatternLimit: Infinity }` を指定。
- **局面:** 相手アタッカー（サイズ5）、自陣ブロッカー2体（サイズ3, サイズ4）。
- **検証結果:** 4 つの全合法パターン（ブロックなし、単体ブロック、2体合算ブロック）について、旧Policyと新Policyのベーススコア・戦術スコア・最終スコアが完全一致（不一致 0 件）。ブロック特徴量（t14〜t16）が正常に計算されることを確認。

### 3.3 修正B: ストリーミングブロックの Golden Fixture (Scenario 7)
- **生成手法:** 同一盤面から Method A（通常列挙: `maxFullPatternLimit: Infinity`）と Method B（ストリーミング列挙: `maxFullPatternLimit: 0`）を生成。
- **構造検証:** `streamReq.patterns.length === 0`, `streamReq.blockAssignmentStream !== undefined` を確認。
- **4経路比較:**
  1. 旧Policy 通常列挙 vs 新Policy 通常列挙: ベーススコア差 0.0、戦術スコア差 0.0、最善手一致
  2. 旧Policy ストリーミング vs 新Policy ストリーミング: ベーススコア差 0.0、戦術スコア差 0.0、最善手一致
  3. 新Policy 通常列挙 vs 新Policy ストリーミング: 単体評価 baseScore 差 0.0、tacticalFeatures 差 0.0、UnitAssignment 一致
  4. 旧Policy 通常列挙 vs 旧Policy ストリーミング: 一致
- **UnitAssignment 一致:** 実際に選ばれたブロック割り当て内容が 4 経路すべてで同一であることを検証。

### 3.4 修正C: 最高スコア同点のタイブレーク検証 (Scenario 8)
- **局面構成:** 全重みゼロ評価時に最高スコアとなるアクション（Attack）を同一カタログ参照で 2 件用意（patternRef 0, patternRef 1）。低スコアの PASS（patternRef 2）を併置。
- **検証結果:**
  - `patternRef 0` スコア: `-0.006292959055712255`
  - `patternRef 1` スコア: `-0.006292959055712255`（同点最高位）
  - `patternRef 2` (PASS) スコア: `-0.035057398998292216`
  - 選択結果: 最小 patternRef である `selectedPatternRef = 0` が決定論的に選択される。
  - 順序反転耐性: パターン配列の順序を反転させた場合も、先頭インデックス（0）が安定して選択される。
  - `choose()` と `evaluatePatterns()` の双方が完全に同一の選択を返すことを確認。

### 3.5 修正D: Golden Fixture の不変性（テスト時上書き防止）
- **分離設計:**
  - 生成処理: `tools/simulator/src/tests/ai/generateGoldenParityFixture.ts`（スタンドアロン実行用）
  - 検証処理: `tools/simulator/src/tests/ai/gen9IndependentGoldenParity.test.ts`（読み取り専用）
  - 固定 Fixture: `tools/simulator/evidence/gen9-work5-5b/golden_parity_fixture_r2.json`
- **不変性実証:**
  - テスト実行前 SHA-256: `E8E38FCBDFA1285985CF7D87F74B8717A7986E37A1C10AD641A9616241961D17`
  - テスト実行後 SHA-256: `E8E38FCBDFA1285985CF7D87F74B8717A7986E37A1C10AD641A9616241961D17`（1ビットも変化なし）
  - 通常のテスト実行によって Git 作業ツリーが汚れないことを確認。

### 3.6 旧コミット実装の独立性と限界
- **抽出コード:** `tools/simulator/src/tests/ai/oldGen9_efe071f65.ts`
- **独立性の範囲:** 旧コミット `efe071f65` の `Gen9LearnableTacticalPolicy` 実装（t00〜t19 の戦術符号化、重み内積、PASS免除判定ロジック、ブロック単体評価）を忠実に保持。新特徴量（t20〜t23）は一切含まない。
- **限界と共通依存:** ベース特徴量エンコーダ（`DecisionFeatureEncoder`）およびゲノムスコアラー（`GenomeScorer`）、`DecisionDNACodec` は現行コードベースのものを共通参照している。完全な別リポジトリ/別プロセス環境ではないが、戦術ポリシー層（Gen9TacticalPolicy）における計算結果の独立性検証としては十分な分離度を確保している。

---

## 4. パリティ検証集計結果サマリ

- **検証対象局面数:** 10 局面
- **検証候補手総数:** 37 手
- **厳密一致件数 (差分 < 1e-12):** 37 / 37 手 (100%)
- **許容誤差一致件数:** 37 / 37 手 (100%)
- **不一致件数:** **0 件**
- **最善手 (Argmax) 一致率:** 10 / 10 局面 (100%)
- **通常 vs ストリーミング一致率:** 100% (選択割り当て内容完全一致)

---

## 5. 全体テスト・ビルド・動作確認結果

| コマンド | 検証内容 | 結果 | 備考 |
| :--- | :--- | :---: | :--- |
| `npm run build` | TypeScript 型チェック & Vite 本番バンドルビルド | **成功 (0 エラー)** | CI 型エラー 13 件完全解消 |
| `vitest run <Gen9関連7スイート>` | Gen9 戦術・ブロック・PASS条件・コスト特徴量・独立パリティ | **全 90 テスト成功 (7ファイル)** | 独立パリティ (10 tests) 含む |
| `npm run playable:check` | 全コアフロー統合対戦シミュレーション | **成功 (1戦通し完走)** | Attack, Block, DamageJudge, Draw, Quick, 勝敗判定 |

---

## 6. 未解決事項

現時点で未解決事項（ブロック要因）は **0 件** である。
CI のビルド失敗原因は完全に解消され、パリティ検証基盤は不変かつ決定論的に固定された。
