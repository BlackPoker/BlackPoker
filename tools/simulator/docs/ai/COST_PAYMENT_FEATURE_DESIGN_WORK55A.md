# BlackPoker — Gen 9 コスト支払い評価特徴量設計書 (Work 5-5A)

**Work ID:** `BP-SIM-AI-GEN9-WORK55A-COST-PAYMENT-FEATURE-DESIGN`  
**対象リポジトリ:** `BlackPoker/BlackPoker`  
**対象ブランチ:** `BlackPoker/issue551-core-flow`  
**基準コミット (HEAD):** `a2ce40e294f897be9c0514d3293a4ef9e0ef85bc`  
**設計ステータス:** 設計完了（実装・学習・評価は着手せず設計書・計画書のみ永続化）

---

## 意思決定サマリー (Executive Summary)

本設計書は、Work 5-4C で確認された「AI のコスト支払い候補間同点率 100%（全 59,087 グループ完全衝突）」という構造的課題を解決するための新特徴量設計である。

| 項目 | 決定事項 |
|:---|:---|
| **推奨する Schema 拡張方法** | **案B: Gen 9 戦術特徴量拡張 (Tactical Feature Extension)**<br>現行 20 次元の戦術特徴量ベクトルに、独立したコスト戦術特徴量（4〜5次元）を追加する。既存 Schema v6 ベース DNA（23,738パラメータ）を完全無傷で維持し、ゼロ重み互換性（既存 AI との完全一致）を保証する。 |
| **初回実装する特徴量数** | **4次元（コア構成）+ 1次元（防壁拡張）= 計 5 特徴量** |
| **各特徴量の役割** | 1. `cost_discard_value_sum`: 廃棄カードのランク数値合計（通常カードの質・ランク差を識別）<br>2. `cost_discard_joker_count`: 廃棄 Joker 枚数（特異カードの喪失を識別）<br>3. `cost_sacrifice_unit_size_sum`: 犠牲ユニットの戦力サイズ合計（盤面戦力損失を識別）<br>4. `cost_life_fraction`: 現在ライフに対する支払い割合（致死・危険度状況依存性を識別）<br>5. `cost_driven_bulwark_size_sum`: ドライブ防壁のサイズ合計（防壁リソース消費を識別） |
| **なぜその数に絞ったか** | コストの4大資源（手札、防壁、ユニット、ライフ）に対応する「質（value / size / ratio）」に厳選し、既存の「数量（count）」特徴量と完全に直交させるため。過剰な特徴量追加による学習次元爆発や過学習を防ぐ。 |
| **既存 AI との互換性** | 新戦術重みを `0.0` と設定することで、既存 Champion および Gen 9 R4 / Gen 8 の挙動とビット単位で完全一致（`score_delta = 0.00000000`）する。 |
| **最大のリスク** | 特定のカード（高ランクやJoker）やライフの消費を過剰に嫌う負の重みが学習され、本来決定打となるアクションや致死回避 Counter を躊躇する「過剰な温存（Hoarding Stall）」が生じるリスク。 |
| **次の Work で何を実装すべきか** | 特徴量エンコーダーへの 5 特徴量の純粋関数追加、単体テスト（C1〜C12検証）、および Work 5-4C 局面による識別能力（同点率解消）の計測。 |

---

## 1. Work ID・調査対象コミット

- **Work ID:** `BP-SIM-AI-GEN9-WORK55A-COST-PAYMENT-FEATURE-DESIGN`
- **調査対象コミット:** `a2ce40e294f897be9c0514d3293a4ef9e0ef85bc`（GitHub 確認済み HEAD）
- **前提ブランチ:** `BlackPoker/issue551-core-flow`

---

## 2. Work 5-4C 診断結果の要約

Work 5-4C（診断 Seed `790001〜790030`, 全60試合）において、以下の定量結果が得られた。

| 指標 | 観測結果 | 構造的解釈 |
|:---|:---:|:---|
| **診断対象判断数** | 3,779 局面 | 差分候補が存在する有効な局面数 |
| **キーカード差分グループ** | 103,168 グループ | 召喚・Counter 等で異なるキーカードを選ぶ候補群 |
| **キーカード全候補同点率** | 0.01% (9/103,168) | 現行特徴量はキーカードのランク・スート・サイズを十分に識別できている |
| **コスト差分グループ** | 59,087 グループ | アクション発動時に異なるコストの支払い方を選ぶ候補群 |
| **コスト全候補同点率** | **100.0% (59,087/59,087)** | **現行特徴量体系では、コスト候補の違いを一切識別できていない** |
| **実対戦コスト同点率 (Gen 8)** | **100.0% (27/27)** | 実対戦でも全件がスコア差 0.0000 によるタイブレーク選択 |
| **実対戦コスト同点率 (Gen 9 R4)** | **100.0% (62/62)** | 実対戦でも全件がスコア差 0.0000 によるタイブレーク選択 |

本結果は、診断専用 Seed による観測結果であるが、既存特徴量体系が「コスト支払い対象の違いを本質的に捉えられない」という構造的欠落を証明している。

---

## 3. 既存コスト特徴量の調査結果

対象ファイル：
- `tools/simulator/src/domain/ai/DecisionFeatureTypes.ts`
- `tools/simulator/src/engine/ai/DecisionFeatureEncoder.ts`
- `tools/simulator/src/domain/ai/DecisionFeatureScalingRegistry.ts`

### 3.1 既存のコスト関連特徴量（全6種）

現行の Pattern Feature（全143次元）の第4セクション（インデックス 29〜34）に、以下の 6 特徴量が定義されている。

```typescript
// DecisionFeatureScalingRegistry.ts (Schema v6)
{ index: 29, name: "has_cost", scalingClass: "BOOLEAN", scalingFunction: "identity", parameter: {}, outputDomain: "[0, 1]" }
{ index: 30, name: "cost_discard_count", scalingClass: "NONNEGATIVE_COUNT", scalingFunction: "saturating_rational", parameter: { scale: 4 }, outputDomain: "[0, 1)" }
{ index: 31, name: "cost_driven_bulwark_count", scalingClass: "NONNEGATIVE_COUNT", scalingFunction: "saturating_rational", parameter: { scale: 4 }, outputDomain: "[0, 1)" }
{ index: 32, name: "cost_sacrificed_unit_count", scalingClass: "NONNEGATIVE_COUNT", scalingFunction: "saturating_rational", parameter: { scale: 4 }, outputDomain: "[0, 1)" }
{ index: 33, name: "cost_life_count", scalingClass: "NONNEGATIVE_COUNT", scalingFunction: "saturating_rational", parameter: { scale: 4 }, outputDomain: "[0, 1)" }
{ index: 34, name: "cost_total_item_count", scalingClass: "NONNEGATIVE_COUNT", scalingFunction: "saturating_rational", parameter: { scale: 5 }, outputDomain: "[0, 1)" }
```

### 3.2 既存特徴量の計算ロジック (`DecisionFeatureEncoder.ts:806-824`)

```typescript
let hasCost = 0;
let costDiscardCount = 0;
let costDrivenBulwarkCount = 0;
let costSacrificedUnitCount = 0;
let costLifeCount = 0;
let costTotalItemCount = 0;

if (p.costPaymentRef !== undefined && catalog?.costPayments) {
  const cp = catalog.costPayments[p.costPaymentRef];
  if (cp) {
    hasCost = 1;
    costDiscardCount = cp.discardedCardIds?.length ?? 0;
    costDrivenBulwarkCount = cp.drivenBulwarkUnitIds?.length ?? 0;
    costSacrificedUnitCount = cp.sacrificedUnitIds?.length ?? 0;
    costLifeCount = cp.lifeCount ?? 0;
    costTotalItemCount = costDiscardCount + costDrivenBulwarkCount + costSacrificedUnitCount + costLifeCount;
  }
}
```

---

## 4. 現在の識別不能が生じる構造

### 4.1 「数量（Count）」と「質（Value / Identity）」の乖離

上記のコードから明らかな通り、既存エンコーダーは `CostPayment` の各配列の `length`（個数）と `lifeCount`（数値）しか参照していない。

同一アクションを発動する際、ルール上要求されるコスト数量は固定である（例:「手札を1枚捨てる」「防壁を1体ドライブする」）。
そのため、プレイヤーが選択可能な合法手群は、**「同じ数量で異なるリソースを指定する候補」**の集合となる。

- **候補A:** 手札の `Club 3` (rank 3) を捨てる $\rightarrow$ `cost_discard_count = 1`
- **候補B:** 手札の `Spade 13` (rank 13) を捨てる $\rightarrow$ `cost_discard_count = 1`
- **候補C:** 手札の `Joker` を捨てる $\rightarrow$ `cost_discard_count = 1`

このとき、既存 6 特徴量の出力値はすべて等しく `[1, 1/(1+4), 0, 0, 0, 1/(1+5)] = [1, 0.2, 0, 0, 0, 0.1667]` となり、**特徴量差分が完全な 0.0000 となる**。

### 4.2 キーカード・ユニット選択との実装格差

同一ファイル内の他セクションでは、観測マップ（`allKnownCardsMap`, `allUnitsMap`）を利用して質的情報が抽出されている。

- **Key Card Selection (`Encoder.ts:840-875`):**
  `allKnownCardsMap.get(instanceId)` により、カードの `suit`, `rank`, `value`, `isJoker` を取得し、`key_card_value_sum`, `key_card_value_max`, `key_card_joker_count` 等を算出。
- **Key Unit Selection (`Encoder.ts:888-912`):**
  `allUnitsMap.get(uId)` により、ユニットの `currentSize`, `state` ('charge'|'drive') を取得し、`selected_unit_size_sum` 等を算出。

**結論:** コスト支払い処理のみが、この観測マップ参照を行っておらず、配列長のみを記録していた。これが Work 5-4C で観測されたコスト同点率 100% の根本的かつ直接的な原因である。

---

## 5. 新特徴量候補一覧

各コスト種類について検討した候補一覧を以下に示す。

### 5.1 手札廃棄カード（Discard）

| 候補名 | 表す情報 | 算出根拠 |
|:---|:---|:---|
| `cost_discard_value_sum` | 廃棄カードのランク数値合計 | `allKnownCardsMap` の `value`（通常 1〜13, Joker は 0）の合計 |
| `cost_discard_value_max` | 廃棄カードの最大ランク数値 | 複数枚廃棄時の最大ランク |
| `cost_discard_value_min` | 廃棄カードの最小ランク数値 | 複数枚廃棄時の最小ランク |
| `cost_discard_joker_count` | 廃棄する Joker の枚数 | `allKnownCardsMap` の `isJoker` 枚数 |
| `cost_discard_hand_value_ratio` | 手札総数値に対する廃棄数値の比率 | $\text{discardValueSum} / \text{selfHandValueSum}$ |
| `cost_discard_rank_multiplicity_loss` | ペア等の重複ランク減少度 | 廃棄によってペアが崩れるかどうかの指標 |

### 5.2 防壁ドライブ（Bulwark Driven）

| 候補名 | 表す情報 | 算出根拠 |
|:---|:---|:---|
| `cost_driven_bulwark_size_sum` | ドライブする防壁のサイズ合計 | `allUnitsMap` の防壁 `currentSize` 合計 |
| `cost_bulwark_remaining_charge_count` | 支払い後の残存チャージ防壁数 | 自陣チャージ防壁数 $-$ ドライブ防壁数 |
| `cost_bulwark_charge_loss_ratio` | チャージ防壁の減少比率 | ドライブ数 / 自陣チャージ防壁数 |

### 5.3 ユニット犠牲（Sacrifice Unit）

| 候補名 | 表す情報 | 算出根拠 |
|:---|:---|:---|
| `cost_sacrifice_unit_size_sum` | 犠牲にするユニットのサイズ合計 | `allUnitsMap` の犠牲ユニット `currentSize` 合計 |
| `cost_sacrifice_unit_size_max` | 犠牲にするユニットの最大サイズ | 複数犠牲時の最大戦力 |
| `cost_sacrifice_remaining_field_ratio`| 犠牲後の残存戦力（サイズ）比率 | 残存フィールド合計サイズ / 全フィールドサイズ |
| `cost_sacrifice_charged_unit_count` | 犠牲ユニット中のチャージ状態数 | チャージユニット（将来アクション可能）の犠牲数 |

### 5.4 ライフ支払い（Life Payment）

| 候補名 | 表す情報 | 算出根拠 |
|:---|:---|:---|
| `cost_life_fraction` | 現在ライフに対する支払い割合 | $\text{lifeCount} / \max(1, \text{selfLifeCount})$ |
| `cost_life_remaining_ratio` | 支払い後のライフ残存比率 | $(\text{selfLifeCount} - \text{lifeCount}) / 10$ |
| `cost_life_critical_risk` | 危険域（残り2点以下等）突入指標 | 支払い後のライフが 2 以下のとき 1.0、それ以外 0.0 |

---

## 6. 特徴量の採用優先度 (P0 / P1 / P2 分類)

| 区分 | 定義基準 | 該当候補 | 採用方針 |
|:---:|:---|:---|:---:|
| **P0**<br>(最優先) | - 実装難易度が低く、$O(1)$〜$O(K)$ で決定論的に計算可能<br>- 既存の数量特徴量と完全に直交し、候補間衝突を直接解決<br>- 公開観測情報のみで安全に算出可能<br>- 固定戦略を埋め込まず、線形重みで学習可能 | 1. `cost_discard_value_sum`<br>2. `cost_discard_joker_count`<br>3. `cost_sacrifice_unit_size_sum`<br>4. `cost_life_fraction`<br>5. `cost_driven_bulwark_size_sum` | **初回実装対象<br>(計5次元)** |
| **P1**<br>(次段階) | - 局面依存性が高く、残存構成や比率に関わる指標<br>- 初回 P0 の効果検証後に必要に応じて段階導入 | - `cost_discard_hand_value_ratio`<br>- `cost_bulwark_charge_loss_ratio`<br>- `cost_sacrifice_remaining_field_ratio`<br>- `cost_sacrifice_charged_unit_count` | 次期 Work で<br>検討 |
| **P2**<br>(実験/対象外) | - 複数手先の合法手減少予測や相手非公開情報の推定を伴う<br>- 計算量・設計複雑度が過大 | - `cost_discard_rank_multiplicity_loss`<br>- 将来合法手期待値減少予測<br>- 非公開情報推定損失 | **今回は不採用** |

---

## 7. P0 候補の詳細仕様 (全15項目)

### 7.1 `cost_discard_value_sum`
1. **特徴量名:** `cost_discard_value_sum`
2. **意味:** 廃棄コストとして手札（等）から捨てるカード群のランク数値合計。
3. **入力元:** `catalog.costPayments[p.costPaymentRef].discardedCardIds`, `PlayerObservation.players[viewer].handCards` (`allKnownCardsMap`)。
4. **計算式:** $\text{raw} = \sum_{id \in \text{discardedCardIds}} \text{value}(id)$  
   （通常カード: A=1, 2=2, ..., 10=10, J=11, Q=12, K=13。Joker: 0。観測不能カード: 0）。
5. **正規化方法:** `saturating_rational(raw, 10)` $\rightarrow f(x) = x / (x + 10)$。  
   ※1枚廃棄時（ランク1〜13）は $1/11 \approx 0.091$ 〜 $13/23 \approx 0.565$ に滑らかに分布。2枚廃棄時（最大26）も $26/36 \approx 0.722$ と有界区間内に収まる。
6. **値域:** $[0, 1)$。
7. **欠損時の扱い:** 観測不能カード、ID不一致は 0 として安全に加算（フェイルクローズ）。
8. **コストが存在しない場合の値:** `0.0`。
9. **同一DecisionRequest内で差分を生み出す条件:** 異なるランクのカードを捨てる合法手が存在する場合（例: C3 vs C8）。
10. **既存特徴量との重複:** 既存 `cost_discard_count`（枚数）とは直交。「枚数（量）」と「ランク（質）」を独立して表現。
11. **計算量:** $O(K)$（$K$ は廃棄枚数、通常 1〜2）。マップ参照は $O(1)$。
12. **秘密情報への依存有無:** なし。自手札は viewer に完全公開（`isViewer === true`）。
13. **Master＋Extraへの適用可能性:** 完全汎用。カードランクの数値定義にのみ依存。
14. **特徴量を学習でどう使えるか:** 負の重みで「高ランクカード温存」、正の重みで「低ランク温存（高ランク積極消費）」。
15. **想定される誤学習の危険性:** 過大な負の重みにより、低ランクカードばかり捨ててペア形成機会を逃すリスク。

### 7.2 `cost_discard_joker_count`
1. **特徴量名:** `cost_discard_joker_count`
2. **意味:** 廃棄コストに含まれる Joker カードの枚数。
3. **入力元:** `discardedCardIds`, `allKnownCardsMap`。
4. **計算式:** $\text{raw} = \sum_{id \in \text{discardedCardIds}} \mathbb{I}(\text{isJoker}(id))$。
5. **正規化方法:** `identity`（通常 0 または 1）。
6. **値域:** $[0, 1]$（2枚以上捨てるルールがある場合は `saturating_rational(raw, 1)`）。
7. **欠損時の扱い:** `0`。
8. **コストが存在しない場合の値:** `0.0`。
9. **同一DecisionRequest内で差分を生み出す条件:** 手札の Joker を捨てる手と通常カードを捨てる手が両方合法である場合。
10. **既存特徴量との重複:** なし。Joker の数値 0 と通常カード A（数値 1）を明確に分離。
11. **計算量:** $O(K)$。
12. **秘密情報への依存有無:** なし。
13. **Master＋Extraへの適用可能性:** 完全汎用。
14. **特徴量を学習でどう使えるか:** 大きな負の重みで「Joker を安易にコストにしない温存戦略」を獲得可能。
15. **想定される誤学習の危険性:** 過度な忌避により、相手の致死アタックを防ぐ Counter のコストとして Joker を捨てるべき緊急時にも拒否してしまうリスク。

### 7.3 `cost_sacrifice_unit_size_sum`
1. **特徴量名:** `cost_sacrifice_unit_size_sum`
2. **意味:** コストとして犠牲にする自陣ユニットの戦力サイズ合計。
3. **入力元:** `catalog.costPayments[p.costPaymentRef].sacrificedUnitIds`, `PlayerObservation.players[viewer].field` (`allUnitsMap`)。
4. **計算式:** $\text{raw} = \sum_{id \in \text{sacrificedUnitIds}} \text{currentSize}(id)$。
5. **正規化方法:** `saturating_rational(raw, 3)` $\rightarrow f(x) = x / (x + 3)$。
6. **値域:** $[0, 1)$。
7. **欠損時の扱い:** `0`。
8. **コストが存在しない場合の値:** `0.0`。
9. **同一DecisionRequest内で差分を生み出す条件:** 戦力サイズの異なる自陣ユニット（例: サイズ1の兵士 vs サイズ3の兵士）を犠牲にする選択肢がある場合。
10. **既存特徴量との重複:** 既存 `cost_sacrificed_unit_count`（体数）と直交。
11. **計算量:** $O(U)$（$U$ は犠牲数、通常 1）。
12. **秘密情報への依存有無:** なし。自陣盤面ユニットは完全公開。
13. **Master＋Extraへの適用可能性:** 完全汎用。
14. **特徴量を学習でどう使えるか:** 負の重みで「大型ユニットを守り、小型ユニットを犠牲にする」判断を学習。
15. **想定される誤学習の危険性:** 墓地利用戦略（リアニメイト等）で高サイズを敢えて落とす有利な手を阻害するリスク。

### 7.4 `cost_life_fraction`
1. **特徴量名:** `cost_life_fraction`
2. **意味:** 支払うライフ点数が、現在の自ライフ残数に占める割合。
3. **入力元:** `catalog.costPayments[p.costPaymentRef].lifeCount`, `PlayerObservation.players[viewer].lifeCount`。
4. **計算式:** $\text{raw} = \text{costLifeCount} / \max(1, \text{selfLifeCount})$（1.0を超える場合は 1.0 にキャップ）。
5. **正規化方法:** `identity`（定義により有界な比率）。
6. **値域:** $[0, 1]$。
7. **欠損時の扱い:** `0.0`。
8. **コストが存在しない場合の値:** `0.0`。
9. **同一DecisionRequest内で差分を生み出す条件:** ライフ支払いコストを含むアクションと他アクションの比較、またはライフ残数が異なる局面での同量支払いの評価。
10. **既存特徴量との重複:** 既存 `cost_life_count`（絶対枚数）と直交。「残りライフに対する相対的危険度」を表現。
11. **計算量:** $O(1)$。
12. **秘密情報への依存有無:** なし。Viewer 自身のライフ枚数は公開情報。
13. **Master＋Extraへの適用可能性:** 完全汎用。
14. **特徴量を学習でどう使えるか:** 負の重みにより「低ライフ時におけるライフ支払いの強い忌避」を自然に学習。
15. **想定される誤学習の危険性:** ライフに余裕がある序盤でもライフ支払いを忌避し、強力なアクションを撃たなくなるリスク。

### 7.5 `cost_driven_bulwark_size_sum`
1. **特徴量名:** `cost_driven_bulwark_size_sum`
2. **意味:** コストとしてドライブ状態にする自陣防壁ユニットのサイズ合計。
3. **入力元:** `catalog.costPayments[p.costPaymentRef].drivenBulwarkUnitIds`, `PlayerObservation.players[viewer].field` (`allUnitsMap`)。
4. **計算式:** $\text{raw} = \sum_{id \in \text{drivenBulwarkUnitIds}} \text{currentSize}(id)$。
5. **正規化方法:** `saturating_rational(raw, 2)` $\rightarrow f(x) = x / (x + 2)$。
6. **値域:** $[0, 1)$。
7. **欠損時の扱い:** `0`。
8. **コストが存在しない場合の値:** `0.0`。
9. **同一DecisionRequest内で差分を生み出す条件:** サイズの異なる防壁（例: 通常防壁 size 1 vs 強化防壁 size 2）が存在し、どちらかをドライブする場合。
10. **既存特徴量との重複:** 既存 `cost_driven_bulwark_count`（体数）と直交。
11. **計算量:** $O(B)$（$B$ はドライブ数、通常 1）。
12. **秘密情報への依存有無:** なし。裏向き防壁であってもユニットサイズは公開情報。
13. **Master＋Extraへの適用可能性:** 完全汎用。
14. **特徴量を学習でどう使えるか:** 負の重みで「大型防壁をチャージ状態のまま温存」する判断を学習。
15. **想定される誤学習の危険性:** 防壁ドライブによるアクション発動を一切行わなくなるリスク。

---

## 8. 情報境界と観測可能性

本設計における全特徴量は、以下の情報セキュリティ境界を厳格に遵守する。

1. **アクセス制限:**
   `GameState`, `GameSession`, 非公開の相手手札カードID・中身、非公開の相手裏向き防壁・切札の中身、未開封パックの中身には一切アクセスしない。
2. **観測マップの適法性:**
   `DecisionFeatureEncoder.encodePatterns()` において構築される `allKnownCardsMap` は、`selfPlayer.handCards`（Viewer自身の手札）および公開フィールド・公開墓地・公開パックカードのみを登録している。非公開カードは登録されないため、カードIDから秘密情報を逆引きすることは不可能である。
3. **防壁カード内容の非参照:**
   防壁のドライブにおいては、裏向きカードのランクやスートは参照せず、フィールド上に公開されている「ユニットの現在のサイズ (`currentSize`)」のみを参照する。これによりプライバシー漏洩を完全に防止する。

---

## 9. Master＋Extra への対応

1. **特定アクション名のハードコード排除:**
   特定のアクション（例: `action.counter`, `action.reinforce` 等）に応じた個別 `if (actionId === ...)` 分岐は一切持たない。
2. **意味的インターフェース依存:**
   合法手パターンが持つ `costPaymentRef` と `DecisionCatalog.CostPayment` の共通構造のみに依存するため、Master ルールセットおよび将来の Extra ルールセットで追加されるあらゆるアクションに対しても同一ロジックで自動的に機能する。

---

## 10. 計算量とメモリ効率

1. **計算量:**
   - 1合法手あたりのコスト特徴量計算は、最大でも数件のIDを `allKnownCardsMap` / `allUnitsMap`（ハッシュマップ、参照 $O(1)$）から引くだけである。
   - 合法手数を $N$、コスト要素数を $K$ とすると、全体の計算量は $O(N \cdot K)$ であり、$N=133, K \le 2$ の場合でも 300 回未満のメモリアクセスで完了する。
2. **ホットパス最適化:**
   - 盤面複製やゲーム進行シミュレーションを一切行わない純粋な決定論的演算であり、毎秒数万〜数十万回の呼び出しに耐えうる。

---

## 11. Feature Schema と DNA 互換性の比較 (案A / 案B / 案C)

新特徴量の統合方式として、以下の 3 案を検討・比較した。

| 比較観点 | 案A: ベース特徴量拡張 (Schema v6 $\rightarrow$ v7) | **案B: Gen 9 戦術特徴量拡張 (推奨)** | 案C: 独立コスト評価モジュール |
|:---|:---|:---|:---|
| **構造** | `PATTERN_FEATURE_NAMES` に 5 次元追加 (143 $\rightarrow$ 148 次元) | `TACTICAL_FEATURE_NAMES` に 5 次元追加 (20 $\rightarrow$ 25 次元) | 独立モジュール `CostPaymentScorer` を新設 |
| **既存 Champion の再現性** | 移行関数（新重み=0）が必要 | **新戦術重み=0 でビット完全一致** | 独立重み=0 で再現可能 |
| **既存 DNA ファイルの互換性** | 互換性破壊（次元数不一致、ローダー改造が必要） | **完全互換** (`metadata.gen9TacticalWeights` 拡張のみ) | 新たなシリアライズ仕様が必要 |
| **パラメータ次元数の増加** | $+5 \text{ (線形)} + 165 \times 5 = +830 \text{ 次元}$ (計 24,568) | **$+5 \text{ 次元}$ のみ (計 25 次元)** | $+5 \text{ 次元}$ のみ |
| **ゼロ重み時の旧Policy一致** | 浮動小数点誤差なく一致可能 | **ビット単位で完全一致（数理的保証）** | 一致可能だがパイプライン複雑 |
| **Context 相互作用の学習** | 双線形行列 $M_{ij}$ で直接学習可能 | 特徴量自身に比率（`cost_life_fraction`等）を含めて代替 | 不可（線形のみ） |
| **実装・検証コスト** | 甚大（Registry, Scaler, Codec, DNA 全面改訂） | **最小**（TacticalEvaluator 拡張のみ、基盤流用） | 中〜大（新規パイプライン構築） |
| **副作用リスク** | コスト以外の全パターンのスコア計算に波及する恐れ | **コスト差分候補にのみ局所的に寄与** | パイプライン分離による不具合 |

---

## 12. 最終推奨構成と選定理由

### 推奨: **案B（Gen 9 戦術特徴量拡張: 20次元 $\rightarrow$ 25次元）**

**選定理由:**
1. **既存資産・進化学習の完全保護:**
   ベース DNA（23,738 パラメータ）を変更すると、過去の全 Champion DNA との互換性が失われ、DNA Codec やスケーリングレジストリ（2,800行）の大規模改修が必要となる。案B であれば、ベース DNA は無傷のまま、戦術重みベクトルへの 5 次元追加のみで完結する。
2. **ゼロ重み安全性の完全保証:**
   追加する 5 特徴量（$t_{20}〜t_{24}$）の重みを `0.0` と設定するだけで、現行の Gen 9 R4 Champion および Gen 8 と全く同一の決定論的振る舞いを 100% 保証できる。
3. **局所性と制御性の高さ:**
   コスト特徴量は「コスト支払いを含む合法手」にのみ非ゼロ値を出力するため、Attack や Pass などの非コスト手番には一切干渉しない。これにより、Work 5-4B で確立したブロック戦術や Counter 戦術の安定性を破壊せずに、コスト選択の改善だけに集中できる。

---

## 13. 未解決事項・リスク

1. **Joker の戦術的価値と重みの競合:**
   Joker を温存する重みが強すぎると、相手の致死アタックを打ち消す緊急 Counter のコストとして Joker を捨てる手が阻害される恐れがある。これについては、Counter 成功時の損害阻止特徴量（$t_{06}〜t_{08}$）との重みバランスが進化学習で適切に調整されるか、実戦検証が必要である。
2. **同ランク・同スートの完全同値性:**
   手札に「Spade 3」と「Heart 3」がある場合、本設計ではスート固定優劣を埋め込まないため、両者は依然として同点となる。ただし、これは BlackPoker のルール上「合理的な等価性」であり、不具合ではない（合法手リスト先頭インデックスによる決定論的タイブレークで十分）。
