# BlackPoker Simulator AI Self-Play Phase 3.4
# 公式AI未完走原因およびポリシー識別性 診断報告書

- 作業ID: `BP-SIM-AI-3.4-20260906-1601`
- 実施日時: 2026-09-06 JST
- Workstream: AI Self-Play / Official Regulation Diagnostics
- 親AI作業ID: `BP-SIM-AI-3.3-20260906-0041`
- 関連UI作業ID: `BP-SIM-UI-2.4.1-20260906-1320`
- 前提Official Regulation作業ID: `BP-SIM-REG-1.0.1-20260905-1805`
- 診断対象リポジトリ: `BlackPoker/BlackPoker`
- 診断対象ブランチ: `BlackPoker/issue551-core-flow`
- 診断バージョン: `1.0.0`
- 診断論理ダイジェスト (Diagnostics Digest): `e34ab8a197f96e5d1af8c0368afcd1ee90bfc21862b4035f636bcbfc1b2762cf`
- 参照元ベースラインダイジェスト (Source Baseline Digest): `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4`

---

## 1. 目的と診断スコープ (Objective & Diagnostics Scope)

Phase 3.3 公式ベースライン測定（`Light + Entry16`, 600戦）において観測された、以下の2大課題について、決定論的かつ数理的なエビデンスに基づいて根本原因を究明することを目的とする。

1. **未完走対戦（INCOMPLETE）の発生原因**:
   - `maxDecisions = 500` で発生した 111 件の未完走対戦（SeededRandom戦: 各13件、非確率的対戦: 各24件）について、ステップ予算を 1000, 2000 へ段階的拡大し、完走可能性・収束速度・状態再帰（State Recurrence: State Hash v2）・決定的サイクル候補を測定。
2. **ポリシー識別性欠如（100% 一致）の発生原因**:
   - `FirstLegal`, `ZeroGenome`, `ManualGenericGenome` の反実仮想一致率が 100% となった数理的要因（スコアマージン、Argmax タイ、選択肢多寡、合法的パターン生成順序）の解明。

> [!NOTE]
> 本フェーズは「診断」に特化しており、ルール・Core Flow・Feature Schema・DNA v1・ベースライン値自体の変更は一切行わない。

---

## 2. 前提Baselineと不変条件 (Baseline Premise & Invariants)

- **Source Baseline Digest**: `0f16b7d3f6193d58b016a5f5aeae9e5caef1c3faf5be2d5822027835c42ddaa4` (Phase 3.3 成果物と完全一致)
- **一次ベースライン実行予算**: `primaryMaxDecisions = 500`
- **対象対戦数**: 6カード × 各100戦 = 600戦
- **未完走件数照合**: Phase 3.3 成果物から動的検証を行い、完全一致（`111件 / 600戦 (18.5%)`）を確認。
- **不変性保証**: Phase 3.3 の元成果物（`reports/ai/official-light-entry16-baseline-v1.json`）は改変せず、互換性ゲートを通過。

---

## 3. 未完走対戦一覧と再現性 (Incomplete Cases List & Reproducibility)

全 111 件の未完走対戦は、`IncompleteReproductionRecipe`（対戦ID, baseSeed, pairId, legId, matchIndex, matchSeed, p1, p2）により 1 対戦単位で決定論的に 100% 再現可能である。

| 対戦カード (Pair ID) | Primary 500 未完走数 | Leg A (P1/P2) | Leg B (P2/P1) | 決定論的マッチ |
| :--- | :---: | :---: | :---: | :---: |
| `firstLegal-vs-seededRandom` | 13 | 7 | 6 | 偽 (RNG依存) |
| `firstLegal-vs-zeroGenome` | 24 | 12 | 12 | 真 (完全決定論) |
| `firstLegal-vs-manualGeneric` | 24 | 12 | 12 | 真 (完全決定論) |
| `seededRandom-vs-zeroGenome` | 13 | 6 | 7 | 偽 (RNG依存) |
| `seededRandom-vs-manualGeneric` | 13 | 6 | 7 | 偽 (RNG依存) |
| `zeroGenome-vs-manualGeneric` | 24 | 12 | 12 | 真 (完全決定論) |
| **合計** | **111** | **55** | **56** | - |

---

## 4. 予算1000ステップ診断 (Budget 1000 Scaling Diagnostics)

未完走 111 件全件に対し、ステップ予算を 1000 (`secondaryMaxDecisions`) へ拡大して再実行した結果：

- **1000ステップ以内に完走した試合数**: `0 件 (0.0%)`
- **1000ステップでも未完走の試合数**: `111 件 (100.0%)`
- **分析**: ステップ上限を 2 倍に引き上げても、1 件も追加完走しなかった。単なる「判断回数の不足による緩慢なゲーム進行」ではないことが判明。

---

## 5. 予算2000ステップ診断 (Budget 2000 Scaling Diagnostics)

さらにステップ予算を 2000 (`tertiaryMaxDecisions`) へ拡大して再実行した結果：

- **2000ステップ以内に完走した試合数**: `0 件 (0.0%)`
- **2000ステップでも未完走の試合数**: `111 件 (100.0%)`
- **分析**: ステップ上限を 4 倍（2000回）に引き上げても全 111 件が完走しなかった。

---

## 6. 状態再帰（State Recurrence）診断 (State Recurrence Diagnostics)

State Hash v2 (`sh2-...`) を用いて、2000 ステップ間の全状態遷移をトラッキングした結果：

- **同一 State Hash への再訪が発生した対戦数**: `0 / 111 件 (0.0%)`
- **状態あたりの最大訪問回数 (maxVisitsPerStateHash)**: `1 回`
- **観測されたユニーク状態数**: 各対戦あたり `2000 / 2000 (100%)`
- **最短ループ距離 (shortestObservedRepeatDistance)**: `N/A` (再帰なし)
- **決定的サイクル候補 (Deterministic Cycle Candidates)**: `0 件`

> [!IMPORTANT]
> **重要な発見**:
> ゲームは「全く同じ状態間を循環（閉路ループ）」しているのではなく、**「毎ステップ新しい状態（State Hash が変化）を生成しながら無限に進行」**している。

---

## 7. ターン進行とステージ空PASS診断 (Turn Progress & Generic Core Flow Diagnostics)

Core Flow およびターンの進行状況を追跡した診断結果：

| 指標 | 測定値 |
| :--- | :--- |
| 開始ターン数 (initialTurnCount) | 1 |
| 最終ターン数 (finalTurnCount) | 1 |
| 進行ターン数 (turnsAdvanced) | **0 (全 111 件で Turn 1 のまま進行)** |
| ターンあたり意思決定数 (decisionsPerTurn) | **2000 回 / ターン** |
| 最大ステージ深度 (maxStageDepth) | 6 |
| 終了時ステージ深度 (finalStageDepth) | 0 |
| Stage-Empty PASS 回数 | 0 回 |
| Stage-Empty PASS 最大連続回数 | 0 回 |

### 未完走の根本原因 (Root Cause Mechanism)
1. **Turn 1 の特定フェーズにおける無限連鎖**:
   - 実行ログから明らかなように、`[BUFFER-IMMEDIATE-RESOLVE] 即時誘発アクションを直接解決: action.charge` と `[BUFFER-MOVE] 通常誘発アクションをステージへ積載: action.draw`、さらにそれに伴うトリガー発生（`req-trg-...`）が、ターン終了やメインフェーズの合法的終了判定に至ることなく連鎖している。
2. **State Hash が毎回異なる理由**:
   - トリガーバッファやステージの解決に伴い、内部ID（`req-xxx`, `req-trg-xxx`）、イベント履歴（CanonicalMatchLog / recentEvents）、デッキ/手札の枚数やカード配置などの論理状態が毎ステップ更新されているため、State Hash v2 は常に一意の新規ハッシュを算出し続け、閉路ループ（同一状態再帰）にはならない。
3. **結論**:
   - 未完走の正体は「決定的状態循環（無限ループ）」ではなく、**「ターンが終了せず無限にトリガー・サブアクション要求が連鎖生成される進行発散（Divergent Infinite Action Stream）」**である。

---

## 8. ポリシー識別性の反実仮想診断 (Policy Distinguishability Counterfactual Diagnostics)

全 600 戦中、ポリシーが判断を行った全 87,888 回の `DecisionRequest` に対する反実仮想（Counterfactual）選択の照合結果：

| 比較対象 | 一致回数 / 全判断要求 | 一致率 | 差分件数 |
| :--- | :---: | :---: | :---: |
| FirstLegal vs ZeroGenome | 87,888 / 87,888 | **100.0%** | **0 件** |
| FirstLegal vs ManualGeneric | 87,888 / 87,888 | **100.0%** | **0 件** |
| ZeroGenome vs ManualGeneric | 87,888 / 87,888 | **100.0%** | **0 件** |

### 意思決定要求の選択肢多様性
- **単一選択肢（合法的選択肢が 1 件のみ）**: `75,894 件 (86.4%)`
  - 選択肢が 1 つしかないため、どのポリシーでも当然 100% 一致する。
- **複数選択肢（合法的選択肢が 2 件以上）**: `11,994 件 (13.6%)`
  - 複数選択肢が存在する局面であっても、3 ポリシーの一致率は **100.0% (差分 0 件)** であった。

---

## 9. ZeroGenome のスコア均一性と Argmax タイ診断 (ZeroGenome Diagnostics)

- **全合法パターンのスコアが完全同値（0.0）であった割合**: `87,888 / 87,888 (100.0%)`
- **Argmax タイ発生件数**: `11,994 / 87,888 (13.6%)` (＝複数選択肢の全件)
- **単独トップ（選択肢が 1 件）**: `75,894 / 87,888 (86.4%)`
- **選択された patternRef の分布**:
  - `patternRef = 0`: **87,888 件 (100.0%)**

### 数理的要因
- ZeroGenome は全重みが 0 であるため、あらゆるパターンの計算スコアが常に 0.0 となる。
- 決定論的 Argmax ロジック（`score > bestScore`）により、先頭のパターン（`patternRef = 0`）が `bestScore = 0` を記録し、後続のパターンは同点タイ（`0 > 0` が false）として破棄される。
- したがって、ZeroGenome は数学的に **「常にインデックス 0 を選択する Policy」** となり、FirstLegal と完全に同値になる。

---

## 10. ManualGenericGenome のスコア分布とマージン診断 (ManualGeneric Diagnostics)

ManualGenericGenome は以下の 3 つの特徴量のみに重みを持つ：
- `pattern_is_action`: `+5.0`
- `pattern_is_pass`: `-3.0`
- `pattern_is_effect_selection`: `+5.0`

### 観測メトリクス
- **スコアマージン統計量 (Score Margin: Top Score - 2nd Score)**:
  - 最小値: `0.0`
  - 中央値: `0.0`
  - 平均値: `0.941`
  - 90パーセンタイル: `8.0`
  - 最大値: `8.0`
- **マージン 0（同点タイ）の判断要求数**: `77,550 件 (88.2%)`
- **マージン > 0（有意差あり）の判断要求数**: `10,338 件 (11.8%)`
- **単独 Argmax 要求数**: `76,302 件 (86.8%)`
- **Argmax タイ要求数**: `11,586 件 (13.2%)`

### なぜ FirstLegal と差が出ないのか
1. **合法的パターンの生成順序**:
   - `LegalPatternGenerator` は、ACTION パターンを先頭にアルファベット順で並べ、PASS を常にリストの末尾に配置する。
2. **ACTION が複数ある場合**:
   - すべての ACTION は `pattern_is_action = 1` を持ち、スコアは等しく `+5.0` となる。
   - ACTION 間の差別化特徴量（攻撃力、コスト、対象、ユニット種別等）に重みがついていないため、全 ACTION が同点タイ（`5.0`）となる。
   - タイブレークにより、インデックス 0 の最初の ACTION が選ばれる。これは FirstLegal の選択と一致する。
3. **ACTION 1件と PASS の場合**:
   - ACTION スコア `+5.0`、PASS スコア `-3.0`、マージンは `8.0`。
   - 単独トップで ACTION（インデックス 0）が選ばれる。これも FirstLegal（PASS 以外優先）の選択と一致する。
4. **PASS のみの場合**:
   - PASS（インデックス 0）が選ばれる。FirstLegal と一致する。

> 結論として、現在の Manual Generic Genome の重み付け設定では、**生成される全局面において FirstLegal と同一のインデックスを選択せざるを得ない**。

---

## 11. Feature Collision と Argmax Tie の共起関係 (Feature Collision & Ties)

- **Argmax タイ発生回数**: 11,586 回
- **Argmax タイ発生局面における Feature Collision（特徴量重複）共起件数**: `7,314 件`
- **共起率**: **63.13%**

### 意味合い
- 複数選択肢でタイが発生している局面の 63.13% は、特徴量エンコーダーが別個の合法パターン（異なるカード・対象・アクション）に対して**全く同一の特徴量ベクトルを出力している（Feature Collision）**。
- 残りの 36.87% は、特徴量は異なるものの重みが 0 であるためにスコアがタイとなっている。
- したがって、ポリシーを差別化するためには、**「特徴量の衝突解消」**と**「差別化重みの付与」**の両輪が必要である。

---

## 12. 決定論的再現性の検証 (Repeatability Verification)

本診断ツールは Run A と Run B の 2 回連続独立実行を実施し、完全同一性を検証した。

- **Run A Digest**: `e34ab8a197f96e5d1af8c0368afcd1ee90bfc21862b4035f636bcbfc1b2762cf`
- **Run B Digest**: `e34ab8a197f96e5d1af8c0368afcd1ee90bfc21862b4035f636bcbfc1b2762cf`
- **一致判定**: `true`
- **論理的一致性 (Exact Logical Equality)**: `true`
- **診断実行時エラー**: `0 件`

---

## 13. エビデンスに基づく結論 (Evidence-based Conclusions)

1. **未完走の正体**:
   - 111 件の未完走は、ステップ不足や同一状態ループではなく、**Turn 1 の内部バッファ・トリガー解決連鎖が停止条件に到達しない進行発散**に起因する。
2. **ポリシー無差別の正体**:
   - 選択肢の 86.4% は単一選択肢である。
   - 残り 13.6% の複数選択肢においても、ZeroGenome は全手 0.0 によるタイ、ManualGeneric は同種アクション同一スコアによるタイとなり、いずれもタイブレーク（最小 patternRef 優先）によって先頭の ACTION を選択する。
   - パターン生成器が ACTION を先頭、PASS を末尾にするため、結果的に FirstLegal と 100% 一致する。

---

## 14. 本診断の限界と非ゴール確認 (Limitations & Non-goals)

- **非ゴール厳守**:
  - 本フェーズにおいて、ゲームルール、Core Flow、`maxDecisions = 500`、Feature Schema v1、DNA v1 は一切変更していない。
  - Fitness スカラー値の算出、遺伝的オペレータ（交叉・突然変異）、世代交代、Hall of Fame の導入は実施していない。
- **測定の限界**:
  - 本診断は現行の公式対戦ルール（Light + Entry16）および現行の Core Flow 実装における挙動を観測・定量化したものであり、Core Flow の不具合修正自体は次フェーズのスコープとなる。

---

## 15. 次フェーズへの具体的提言 (Actionable Recommendations)

1. **Core Flow / Regulation 側への提言**:
   - Turn 1 におけるトリガー解決バッファ（`action.charge`, `action.draw` 等）の終端条件、およびターン進行（Turn 2 への遷移）の成立条件を精査し、無限連鎖を抑止するガード機構の検討を推奨する。
2. **AI Feature / DNA 側への提言**:
   - ACTION パターン間の区別（打点、対象、コスト効率等）を表現する Pattern Features の拡充、または複数アクション時のタイを解消するためのランダム/ヒューリスティック重みの導入を推奨する。
