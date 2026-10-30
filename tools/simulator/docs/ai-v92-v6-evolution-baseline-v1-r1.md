# BlackPoker Simulator Feature Schema v6 Evolution Baseline 報告書 (R1)

- **Work ID**: `BP-SIM-AI-V92-V6-EVOLUTION-BASELINE-V1-R1`
- **対象リポジトリ**: `BlackPoker/BlackPoker`
- **対象ブランチ**: `BlackPoker/issue551-core-flow`
- **Start SHA**: `a52e8d91a53ab7371e0afaa2daadd9cbddc38f60`
- **Feature Schema**: `v6` (308 features: Context 165, Pattern 143, Interaction 23,595, Total Weights 23,738)
- **Semantic Diagnostic**: `v2` (`pof2`, `drsf2`, `gpif2`, version 2)
- **ステータス**: **READY FOR INDEPENDENT REVIEW**

---

## 1. 目的

正式承認された Feature Schema v6（308特徴量）および Semantic Diagnostic v2（`pof2`, `drsf2`, `gpif2`）の動作環境下において、既存の進化学習（Evolution Loop / Generation Runner）を再実行し、以下を客観的・決定論的に測定する：
1. **決定論性 (Determinism)**: Run A と Run B の完全独立再構築による全重み・結果・トレースダイジェストの 100% 一致。
2. **対戦完了率 (Match Completion Rate)**: `official:light-entry16` における g0 および g1 の 30 試合の完了・勝敗挙動。
3. **診断互換性 (Diagnostic v2 Validation)**: 複数ターン・Stage解決実測・20手超の代表試合における OFF/ON 完全論理パリティ（Legal Patterns全件の内容・順序の一致を含む）。
4. **Standard+Pack 挙動 (Smoke Analysis)**: キャパシティ上限 200 vs 500 での行動分布・PASS率・End実行回数の客観的実測、および同一Seed先頭200手の一致検証。

> [!NOTE]
> 本作業の目的は現状基盤の「基準測定（Baseline Measurement）」であり、AI Policy や Fitness 関数の改善・調整ではありません。

---

## 2. 実装および実行条件 (Formal Baseline)

- **Core Flow**: 第9.2版コアフロー（フォーカス方式、`system` チャンス、ステージ1件解決）
- **Feature Schema Version**: `6`
- **Context 特徴量次元**: `165` (末尾に `self_is_focus_player` [163], `opponent_is_focus_player` [164] を合法的観測から抽出)
- **Pattern 特徴量次元**: `143`
- **DNA Total Weights**: `23,738` (Pattern 143 + Interaction 23,595)
- **Semantic Diagnostic Version**: `2` (`pof2-`, `drsf2-`, `gpif2-`)
- **母集団規模**: $N = 6$
- **反復回数**: $R = 1$ (Double Round Robin: 30 試合 / 世代)
- **Campaign Seed**: `42`
- **maxDecisions**: `500`

---

## 3. Light-Entry16 Controlled Evolution 測定結果 (Baseline B)

### 3.1 世代別サマリー

| 世代 | generationSeed | 予定 | COMPLETED | INCOMPLETE | FAILED | DRAW | decisions 実測値 (min / max / avg / median) | Runner Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **g0** | `4143575905` | 30 | **30 (100%)** | **0 (0%)** | 0 | 0 | **min 36, max 88, avg 77.73, median 85** | **`ADVANCED`** |
| **g1** | `4126798286` | 30 | **30 (100%)** | **0 (0%)** | 0 | 0 | **min 4, max 84, avg 41.73, median 42** | **`ADVANCED`** |

- **g0 個体**: `genome-000, genome-001, genome-002, genome-003, genome-004, genome-005` (Schema v6 Zero DNA 6個体, 全重み 0.0)
- **g1 個体**: `genome-001, gen-000001-offspring-000000, gen-000001-offspring-000001, gen-000001-offspring-000002, gen-000001-offspring-000003, gen-000001-offspring-000004` (g0 エリート個体 + トーナメント選択・交叉変異によるオフスプリング)
- **決着理由**: 全試合「相手のライフが0になりました」（ライフ枯渇による正常決着、DRAW 0件）。

### 3.2 Run A vs Run B 独立再構築決定論性 (Determinism)

同一条件（Campaign Seed 42, N=6, R=1, maxDecisions=500）から Run A と Run B を独立して完全に再実行し、全項目の一致を検証：

1. **DNA Full Weight Array Exact Equality**:
   - g0: 全6個体の `patternWeights` (143要素) および `contextPatternWeights` (23,595要素) が Run A == Run B で 100% 厳密一致 (`===`)。
   - g1: 全6個体の `patternWeights` (143要素) および `contextPatternWeights` (23,595要素) が Run A == Run B で 100% 厳密一致 (`===`)。
2. **DNA Digests (SHA-256)**:
   - 全個体で `patternWeightsDigest`, `contextPatternWeightsDigest`, `fullDnaDigest` が完全一致。
3. **対戦スケジュール**: 30試合すべての pairIndex, repetitionIndex, legIndex, p1GenomeId, p2GenomeId, matchSeed が完全一致。
4. **試合 Outcome**: 30試合すべての completed, winner, reason, totalDecisions, turnCount, finalStateHash が完全一致。
5. **Decision Trace Logical Projection Digest**:
   - 決定論的論理フィールドから算出した per-match SHA-256 ダイジェストが 30 試合すべて 100% 完全一致。
6. **Fitness Snapshot & Manifest**: 全個体の適応度スコア・勝敗数・マニフェストが完全一致。
7. **Generation Status**: g0 `ADVANCED`, g1 `ADVANCED` が完全一致。

### 3.3 Fitness 保存則 (Conservation Laws) の数学的一致

- $\sum \text{wins} = 30$（決着試合数 30 と一致）
- $\sum \text{losses} = 30$（決着試合数 30 と一致）
- $\sum \text{draws} = 0$（引き分け試合数 0 と一致）
- $\sum \text{completedMatches} = 60$（$2 \times 30$ 試合と一致）
- 各個体の $\text{wins} + \text{losses} + \text{draws} = 10$, $\text{scheduledMatches} = 10$（全個体で成立、`valid: true`）

---

## 4. Diagnostic v2 実践検証 (OFF vs ON Parity)

代表試合を抽出し、同一Seed・同一DNA・同一Match IDによる fresh session を用いて `enableSemanticDiagnostics: false` (OFF) と `true` (ON) で再実行してパリティを検証しました：

| ケース | 対象試合 | 手数 | ターン | Stage解決 (popped/resolved) | OFF/ON パリティ | Diagnostic 観測シグナル |
|---|---|:---:|:---:|:---:|:---:|---|
| **g0 Representative Match** | v6-diag-off-gen-0-match-0 | 86 | 7 | あり (28件解決: action.attack, action.counter, action.counter) | **100% 一致** | cycles=0, stalls=0 |
| **g1 Representative Match** | v6-diag-off-gen-1-match-0 | 52 | 4 | あり (16件解決: action.twist, action.counter, action.counter) | **100% 一致** | cycles=0, stalls=0 |


- **検証項目**:
  - 勝敗結果 (`completed`, `winner`, `reason`, `totalDecisions`, `turnCount`, `finalStateHash`) の 100% 一致。
  - Decision Trace 全件の論理系列 (`logicalDecisionId`, `playerId`, `stateHash`, `selectedPatternRef`, `selectedLogicalPatternKey`, `selectedPatternKind`, `actionId`) の完全一致。
  - **Legal Patterns の内容と順序**: 各判断ステップにおいて選択可能だった合法パターン一覧（`patternRef`, `logicalPatternKey`, `kind`, `actionId`, 選択肢参照番号群）の完全一致。
  - 実行時動的情報（タイムスタンプ・動的 decisionId）を除外した正規化 Canonical Match Log の完全一致。
  - **Stage解決の実測確認**: `turnCount > 1` の推測に頼らず、Match Log から `stage.popped` と `request.resolved` のイベントを直接検出し、Request ID 単位で Stage 上のリクエストが実際に解決されたことを確認。
  - 診断結果に `semanticDiagnosticVersion: 2`、非空の診断トレースにおいて全件フィンガープリントが `pof2-`, `drsf2-`, `gpif2-` で始まることを確認（空トレースによる空振りパスを排除）。
  - ※注意: 診断器によるループ／ストールシグナル検出は「特定の意味論パターンの反復検出」であり、無限ループの数学的証明ではありません。

---

## 5. Standard + Pack Smoke 測定結果 (Cohort A vs Cohort B)

デッキ規模（32枚＋パックカード）および防壁選択肢が豊富な `official:standard-pack` において、Schema v6 Zero DNA による上限到達・行動傾向を調査しました：

### 5.1 Cohort A: `maxDecisions = 200`

| 試合 | シード | 結果 | 手数 | ターン | 勝者 | PASS率 | End回数 | 終了理由 |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 1 | 101 | INCOMPLETE | 200 | 15 | None | 65% | 14 | 最大判断回数 (200) に到達しました。 |
| 2 | 202 | INCOMPLETE | 200 | 13 | None | 66.5% | 12 | 最大判断回数 (200) に到達しました。 |
| 3 | 303 | INCOMPLETE | 200 | 13 | None | 64% | 12 | 最大判断回数 (200) に到達しました。 |
| 4 | 404 | INCOMPLETE | 200 | 15 | None | 67% | 14 | 最大判断回数 (200) に到達しました。 |


### 5.2 Cohort B: `maxDecisions = 500`

| 試合 | シード | 結果 | 手数 | ターン | 勝者 | PASS率 | End回数 | 終了理由 |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 1 | 101 | **COMPLETED** | 329 | 25 | p1 | 66.9% | 24 | Player B のライフが0になりました |
| 2 | 202 | **COMPLETED** | 399 | 27 | p1 | 68.7% | 26 | Player B のライフが0になりました |
| 3 | 303 | **COMPLETED** | 343 | 24 | p2 | 65.3% | 23 | Player A のライフが0になりました |
| 4 | 404 | **COMPLETED** | 208 | 16 | p2 | 67.3% | 15 | Player A のライフが0になりました |


### 5.3 同一Seed 先頭200手決定論性検証 (Prefix 200 Trace Parity)

Cohort A（cap=200で上限停止）と Cohort B（cap=500で完走）について、同一Seedにおける先頭200手の意思決定論理系列（logicalDecisionId, stateHash, selectedPatternRef, legalPatterns等）が100%完全一致することを検証：

| シード | Cohort A (cap=200) トレースダイジェスト (先頭200手) | Cohort B (cap=500) トレースダイジェスト (先頭200手) | 一致判定 |
|:---:|:---:|:---:|:---:|
| 101 | `cadc6f98b9b4939a...` | `cadc6f98b9b4939a...` | **100% 完全一致** |
| 202 | `b36cf0ed4c112f8c...` | `b36cf0ed4c112f8c...` | **100% 完全一致** |
| 303 | `4b780ae84d2b0796...` | `4b780ae84d2b0796...` | **100% 完全一致** |
| 404 | `a59cb25302225609...` | `a59cb25302225609...` | **100% 完全一致** |


- **実証**: 全4シードにおいて Cohort A の全200手と Cohort B の先頭200手は 100% 同一のゲーム展開を辿っており、cap=200 での未完了（INCOMPLETE）は無限ループやデッドロックではなく、同一進行ゲームの単なる時間打ち切り（Truncation）であることが数学的に実証されました。

### 5.4 観測分析とテレメトリ
- **例外発生率**: 全8試合（Cohort A 4試合 + Cohort B 4試合）において未捕捉例外・実行時エラーは **0件**（シミュレータ基盤は安全に稼働）。
- **上限到達**:
  - Cohort A (cap=200): 4/4 試合が 200 手に到達し INCOMPLETE。
  - Cohort B (cap=500): 4/4 試合が COMPLETED、0/4 試合が INCOMPLETE。
- **行動傾向**:
  - PASS割合: 67.1%
  - End実行回数: 平均 22 回
  - アクション分布: action.attack: 88, action.end: 88, action.unsummons: 49, action.twist: 41, action.addBulwark: 30
- **考察**: Standard+Pack では、Zero DNA（全重み0による先頭合法手選択）において防壁展開やクイック召喚などの合法手選択肢が多く、200手以内では決着に至らないケースが多いが、シミュレーターとしてのクラッシュやデッドロックは一切発生していない。

---

## 6. 旧 v5 Baseline Evidence との比較 (Historical Comparison)

| 項目 | 旧 v5 Baseline (Accepted R2) | 新 v6 Baseline (本エビデンス) | 比較・留意事項 |
|---|---|---|---|
| **Feature Schema** | Version 5 | **Version 6** | 次元拡張: Context 163 $	o$ 165, 計 306 $	o$ 308 |
| **focus 特徴量** | 未参照 (0次元) | **`self_is_focus` [163], `opp_is_focus` [164]** | 観測から合法的抽出、鏡像対称性・Fail-Closed 担保 |
| **DNA 総重み数** | 23,452 weights | **23,738 weights** | 行 163, 164 の 286 重みが追加 |
| **Semantic Diagnostic** | v1 (`pof1`, `drsf1`, `gpif1`) | **v2 (`pof2`, `drsf2`, `gpif2`)** | `focusPlayerId` 感度追加 |
| **light-entry16 g0** | 30/30 COMPLETED (100%) | **30/30 COMPLETED (100%)** | 決定統計: min 36, max 88, avg 77.73 |
| **light-entry16 g1** | 30/30 COMPLETED (100%) | **30/30 COMPLETED (100%)** | 決定統計: min 4, max 84, avg 41.73 |
| **Run A/B Determinism** | 100% 一致 | **100% 一致** | DNA実配列・ダイジェスト・Trace全一致 |
| **Standard+Pack (cap=200)** | 4/4 INCOMPLETE | **4/4 INCOMPLETE** | 双方とも例外 0 件、cap 到達による安全停止 |
| **Standard+Pack (cap=500)** | 未測定 | **4 COMPLETED, 0 INCOMPLETE** | cap 拡張による完了挙動を新規測定 |

### 6.1 比較上の留意点 (Cautionary Notes)
1. **DNA 個体差と乱数消費差**:
   - g0 の Zero DNA は全重み 0 であるため同一の先頭手を選択しますが、g1 生成時のトーナメント選択・交叉・変異においては、DNA ベクトル長（23,738 vs 23,452）の相違により生成される重み実値および乱数消費系列に差異が存在します。
2. **性能要因の帰属**:
   - 測定された手数や完了率の差異は、特徴量次元差、変異重み差、乱数消費の複合的影響によるものであり、**「Focus Features の効果のみによって性能が変動した」と直ちに断定することはできません**。

---

## 7. 既知の限界事項 (Known Limitations)

1. **Zero DNA の表現力限界**: 全重みが 0 の初期 DNA は先頭合法手を常に選択するため、複雑なカードプール（Standard+Pack）ではゲーム進行が防壁構築等に偏り、手数が増加する傾向があります。
2. **Standard+Pack における適切な maxDecisions**: 200 手では時間切れ（INCOMPLETE）となるため、今後の学習実験では 500 手以上の設定またはゲーム木探索効率化の検証が推奨されます。

---

## 8. 結論

正式承認された Feature Schema v6 および Semantic Diagnostic v2 のもとで、`official:light-entry16` における g0/g1 進化ループの 100% 決定論的再現性（Run A == Run B）、Fitness 保存則、および Diagnostic OFF/ON 完全論理パリティが実証されました。
また、Standard+Pack における決定回数上限（200 vs 500）の客観的比較データが確立されました。

本成果をもって、独立レビュー準備完了（**READY FOR INDEPENDENT REVIEW**）とします。
