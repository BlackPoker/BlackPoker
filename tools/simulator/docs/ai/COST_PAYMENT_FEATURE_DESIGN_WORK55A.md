# BlackPoker — Gen 9 コスト支払い評価特徴量設計書 (Work 5-5A R1)

**Work ID:** `BP-SIM-AI-GEN9-WORK55A-COST-FEATURE-DESIGN-R1`  
**対象リポジトリ:** `BlackPoker/BlackPoker`  
**対象ブランチ:** `BlackPoker/issue551-core-flow`  
**基準コミット (HEAD):** `8aa24cbc6dc0d90a494d4b4815f6c1206c7a27f0`  
**設計ステータス:** R1 最終改訂完了（独立レビュー指摘の 7 課題を完全反映、コード変更ゼロ）

---

## 意思決定サマリー (Executive Summary)

本設計書は、Work 5-4C で確認された「AI のコスト支払い候補間同点率 100%（全 59,087 グループ完全衝突）」という構造的課題を解決するための新特徴量設計書（R1 改訂版）である。

| 項目 | 決定内容 (R1 確定仕様) |
|:---|:---|
| **推奨する Schema 拡張方法** | **案B: Gen 9 戦術特徴量拡張 (Tactical Feature Extension)**<br>現行 20 次元の戦術特徴量ベクトルに、独立したコスト戦術特徴量（4次元）を追加し、**全 24 次元**とする。既存 Schema v6 ベース DNA（23,738パラメータ）を完全無傷で維持し、旧 20 次元 DNA のゼロパディング復元により 100% の互換性を保証する。 |
| **最終 P0 特徴量数** | **4 特徴量（4次元）**<br>※防壁ドライブ特徴量は、観測仕様上 `currentSize` が `undefined` となり識別根拠を持たないため、P0 から除外（P1 延期）とした。 |
| **各特徴量の役割** | 1. `cost_discard_value_sum`: 廃棄カードのランク数値合計（通常カードの質・ランク差を識別）<br>2. `cost_discard_joker_count`: 廃棄 Joker 枚数の飽和有界値（特異カードの喪失を識別）<br>3. `cost_sacrifice_unit_size_sum`: 犠牲ユニットの戦力サイズ合計（盤面戦力損失を識別）<br>4. `cost_life_fraction`: 現在ライフに対する支払い割合（致死・危険度状況依存性を識別） |
| **Joker 正規化方式** | **案2: `saturating_rational(jokerCount, 1) = jokerCount / (jokerCount + 1)`**<br>複数枚廃棄時も $[0, 1)$ に滑らかに有界化（1枚=0.5, 2枚=0.667, 3枚=0.75）。 |
| **防壁特徴量の判断** | **初回実装から除外（P1 延期）**<br>自陣防壁であっても `ObservationFactory` 上 `currentSize` は常に `undefined` であり、サイズによる差別化が存在しないため。 |
| **旧 20 次元 DNA 復元** | `fromV6CompatibleDNA()` において、長さ 20 の重み配列を検出した場合、**元の 20 重みを完全維持し、末尾 4 重みを `0.0` でパディング**して復元する。決して R4 プリセット重みで上書きしない。 |
| **新旧 Schema バージョン** | 新 Encoder Version: **`v7.3-cost-evaluated-v24`** を定義。<br>旧形式（`v7.2-unified-block-conditional-pass`、20次元）と明確に分離。 |
| **ゼロ重み互換性の前提** | 4つの新重みが `0.0` のとき、数式上旧 Policy と完全一致する。浮動小数点順序・非有限値の安全性を Work 5-5B でビット単位で実証する。 |
| **副作用の認識** | コスト候補同士の選択だけでなく、**「コストありアクション（Counter等）」と「コストなしアクション（PASS等）」の間の選択バランスにも影響**を与える。過度なコスト忌避（Counter 躊躇等）を検証指標に組み込む。 |
| **次期 Work 範囲** | **Work 5-5B:** 特徴量計算の純粋関数実装、単体テスト（C1〜C12）、旧DNA互換性テスト、ゼロ重み完全パリティ検証に限定する（学習・対戦は着手しない）。 |

---

## 1. Work ID・調査対象コミット

- **Work ID:** `BP-SIM-AI-GEN9-WORK55A-COST-FEATURE-DESIGN-R1`
- **調査対象コミット:** `8aa24cbc6dc0d90a494d4b4815f6c1206c7a27f0`（GitHub 確認済み HEAD）
- **対象ブランチ:** `BlackPoker/issue551-core-flow`

---

## 2. Work 5-4C 診断結果の要約

Work 5-4C（診断 Seed `790001〜790030`, 全60試合）において、以下の定量結果が得られている。

| 指標 | 観測結果 | 構造的解釈 |
|:---|:---:|:---|
| **診断対象判断数** | 3,779 局面 | 差分候補が存在する有効な局面数 |
| **キーカード差分グループ** | 103,168 グループ | 召喚・Counter 等で異なるキーカードを選ぶ候補群 |
| **キーカード全候補同点率** | 0.01% (9/103,168) | 現行特徴量はキーカードのランク・スート・サイズを十分に識別できている |
| **コスト差分グループ** | 59,087 グループ | アクション発動時に異なるコストの支払い方を選ぶ候補群 |
| **コスト全候補同点率** | **100.0% (59,087/59,087)** | **現行特徴量体系では、コスト候補の違いを一切識別できていない** |
| **実対戦コスト同点率 (Gen 8)** | **100.0% (27/27)** | 実対戦でも全件がスコア差 0.0000 によるタイブレーク選択 |
| **実対戦コスト同点率 (Gen 9 R4)** | **100.0% (62/62)** | 実対戦でも全件がスコア差 0.0000 によるタイブレーク選択 |

---

## 3. 既存コスト特徴量の調査と根本原因

### 3.1 既存のコスト関連特徴量（全6種）
現行の Pattern Feature（全143次元）の第4セクション（インデックス 29〜34）に定義されている 6 特徴量：
`has_cost`, `cost_discard_count`, `cost_driven_bulwark_count`, `cost_sacrificed_unit_count`, `cost_life_count`, `cost_total_item_count`。

### 3.2 既存エンコーダーの実装欠落
`DecisionFeatureEncoder.ts:806-824` では、`CostPayment` の各配列の `length`（個数）と `lifeCount`（数値）しか参照していない。
キーカード選択（`Encoder.ts:840-875`）では `allKnownCardsMap.get(id)` によりランクや Joker を取得しているのに対し、コスト支払いでは観測マップの参照が一切行われていなかった。これが同点率 100% の直接原因である。

---

## 4. 修正A：既存 DNA・Champion との互換性仕様

### 4.1 現行実装の制約と問題点
`Gen9LearnableTacticalPolicy.ts` において、`fromV6CompatibleDNA()` は `parsed.tacticalWeights.length === TACTICAL_FEATURE_DIMENSION` を厳格に検査している。
新コードで単に `TACTICAL_FEATURE_DIMENSION = 24` に書き換えると、過去の Gen 9 DNA（長さ 20）は検証に失敗し、`fallbackPreset`（デフォルト "r4"）で上書きされ、過去の進化学習重みが消失してしまう。

### 4.2 具体的な移行・復元仕様

#### A. 次元数定数と Schema バージョン
```typescript
export const TACTICAL_FEATURE_SCHEMA_VERSION = 7;

/** 旧 20 次元戦術特徴量仕様 */
export const TACTICAL_FEATURE_DIMENSION_V70 = 20;

/** 新 24 次元戦術特徴量仕様 (Work 5-5B) */
export const TACTICAL_FEATURE_DIMENSION_V73 = 24;

/** 現在の標準戦術特徴量次元数 */
export const TACTICAL_FEATURE_DIMENSION = TACTICAL_FEATURE_DIMENSION_V73;
```

#### B. Encoder Version の新設と対応関係
既存の `v7.2-unified-block-conditional-pass` の意味を変更せず、新バージョンを定義する。

```typescript
export type TacticalFeatureEncoderVersion =
  | "v7.0-legacy-block-stream-only"
  | "v7.1-unified-block-assignment"
  | "v7.2-unified-block-conditional-pass"
  | "v7.3-cost-evaluated-v24";

export const TACTICAL_FEATURE_ENCODER_VERSION_CURRENT: TacticalFeatureEncoderVersion =
  "v7.3-cost-evaluated-v24";
```

| Encoder Version | 次元数 | コスト特徴量 ($t_{20}〜t_{23}$) | PASS 条件判定 | ブロック評価 |
|:---|:---:|:---:|:---:|:---:|
| `v7.0-legacy-block-stream-only` | 20 | なし (0次元) | 無条件減点 | ストリーム単体 |
| `v7.1-unified-block-assignment` | 20 | なし (0次元) | 無条件減点 | 統一ブロック評価 |
| `v7.2-unified-block-conditional-pass` | 20 | なし (0次元) | **有効対抗時のみ減点** | 統一ブロック評価 |
| **`v7.3-cost-evaluated-v24` (新)** | **24** | **P0 コア 4 特徴量** | **有効対抗時のみ減点** | **統一ブロック評価** |

#### C. `fromV6CompatibleDNA()` の移行ロジック
`dna.metadata.notes` からパースした `parsed.tacticalWeights` に対し、以下の厳格な検証・移行を行う：

1. **24 次元の場合 (新DNA):**
   そのまま 24 次元の重みとして採用。
2. **20 次元の場合 (旧Gen9 DNA):**
   **元の 20 重みをそのまま保持し、末尾 4 要素に `0.0` を追加して 24 次元配列を生成する。**
   ```typescript
   const migratedWeights = [...parsed.tacticalWeights, 0.0, 0.0, 0.0, 0.0];
   ```
   ※R4 プリセット重みでの上書きは厳禁とする。
3. **不正な重み長の場合 (19, 21, 23, 25 等):**
   黙ってフォールバックせず、明示的な例外（`Error("不正な戦術重み長...")`）をスローする。
4. **非有限値の検証:**
   配列内に `NaN`, `Infinity`, `undefined` が含まれる場合は即座に例外をスローする。
5. **メタデータの完全保存:**
   個体 ID、名前、世代（`generation`, `createdGeneration`）、`originType`、`parentIds` は一切変更せずそのまま維持する。

#### D. `fromV6DNA()` の仕様
- `preset === "zero"`: 24 次元の `[0, ..., 0]` を生成。
- `preset === "r4"`: 旧 R4 の 20 重みに `[0.0, 0.0, 0.0, 0.0]` を追加した 24 次元配列を生成。
- `preset` が配列の場合: 長さ 20 の場合は末尾 4 要素に `0.0` をパディング。長さ 24 の場合はそのまま受け入れ。それ以外の長さは例外スロー。

#### E. 将来拡張 (30次元等) への備え
各戦術特徴量には正規の名前キー（`t00_...` 〜 `t23_...`）が定義されている。シリアライズ時に名前付きマップまたはバージョン番号を明記し、将来の拡張時にも重みの誤割り当てが発生しない構造とする。

---

## 5. 修正B：Joker 枚数の正規化方式

### 5.1 比較と選定
- **案1 (フラグ):** `cost_discard_has_joker = jokerCount > 0 ? 1 : 0`
  - 課題: 2枚以上の Joker を同時に捨てる手と 1枚捨てる手を区別できない。
- **案2 (飽和有界関数・推奨採用):**
  $$\text{cost\_discard\_joker\_count} = \frac{\text{jokerCount}}{\text{jokerCount} + 1}$$
  - `jokerCount = 0`: $0.0$
  - `jokerCount = 1`: $1/2 = 0.5$
  - `jokerCount = 2`: $2/3 \approx 0.667$
  - `jokerCount = 3`: $3/4 = 0.75$

### 5.2 採用理由
既存の `DecisionFeatureScaler` の標準規則 `saturatingRational(raw, 1)` と完全に同一であり、単一 Joker 廃棄時にも $0.5$ という明確なシグナルを与えつつ、複数枚廃棄時にも値域 $[0, 1)$ を厳格に遵守できる。

---

## 6. 修正C：カード・ユニットの ID 解決失敗とプライバシー境界

### 6.1 3 つの参照状態の厳密分離

| 状態区分 | 定義 | 特徴量上の扱い | エラー・ログ方針 |
|:---|:---|:---|:---|
| **`KNOWN`**<br>(正常解決) | 自プレイヤー手札（`isViewer === true`）に存在し、`visibility === "KNOWN"` であるカード | 実値を使用。<br>- 通常カード: ランク数値 ($1〜13$)<br>- Joker: 数値 $0$, Joker カウント加算 | 正常処理 |
| **`HIDDEN`**<br>(合法非公開) | ルール上合法だが秘密情報であるカード（相手裏向きカード等） | 秘密情報を推測しない。<br>数値 $0$, Joker カウント $0$ | 正常処理（安全側フェイルクローズ） |
| **`INVALID_REFERENCE`**<br>(参照不整合) | 指定されたカード/ユニット ID が観測マップ上に一切存在しない | 数値 $0$, Joker カウント $0$ としてフェイルクローズ | **データ不整合として検出**。<br>- 診断時: エラーログ/例外<br>- 推論時: 警告カウンター記録 |

### 6.2 Joker（値 0）との混同防止
Joker は `isJoker === true` かつ `visibility === "KNOWN"` として明示的に識別される。
未解決カードや不正参照は `isJoker` フラグが立たないため、**「解決失敗したカードが Joker として扱われる」という致命的誤認は完全に排除**される。

---

## 7. 修正D：防壁ドライブ特徴量の妥当性と採用判断

### 7.1 ソースコード調査結果
`ObservationFactory.ts:317-323` を精査した結果、以下の実装が確認された。

```typescript
// ObservationFactory.ts:317-322
// 防壁、および相手の裏向きユニットは秘密情報保護のため currentSize を公開しない (undefined)
const shouldHideSize = isBulwark || (!isViewerOwner && isFaceDown);
const currentSize = !shouldHideSize && state
  ? abilityEvaluator.calculateUnitSize(unit, state)
  : undefined;
```

1. **防壁の `currentSize` は常に `undefined` である:**  
   自陣の防壁であっても、`isBulwark === true` であるため `currentSize` は計算されず `undefined` となる。
2. **防壁同士のサイズ差は存在しない:**  
   エンコーダー内で `u.currentSize ?? 0` を計算した場合、すべての防壁で常に `0` となり、候補間で一切の差分を生み出せない。
3. **無意味な差分作成の禁止:**  
   差分を作るためにカード ID やユニット ID を特徴量化することは、プライバシー保護および手動戦略埋め込み禁止の原則に違反する。

### 7.2 採用判断: **選択肢C（初回実装から除外・P1延期）**
5次元という数字に固執せず、特徴量の有効性を最優先する。
防壁ドライブのサイズ特徴量は有効な識別根拠を持たないため、**P0 から完全に除外**する。

---

## 8. 最終 P0 特徴量仕様 (全4次元)

最終的に初回実装する P0 特徴量は以下の **4 特徴量** とする。

| インデックス | 特徴量名 | 意味 | 計算式 | スケーリング関数 | 値域 |
|:---:|:---|:---|:---|:---|:---:|
| $t_{20}$ | `cost_discard_value_sum` | 廃棄カードのランク数値合計 | $\sum \text{value}(c)$ (通常 1〜13, Joker 0) | saturatingRational(raw, 10) | $[0, 1)$ |
| $t_{21}$ | `cost_discard_joker_count` | 廃棄 Joker 枚数の飽和有界値 | $\sum \mathbb{I}(\text{isJoker}(c))$ | saturatingRational(raw, 1) | $[0, 1)$ |
| $t_{22}$ | `cost_sacrifice_unit_size_sum` | 犠牲ユニットの戦力サイズ合計 | $\sum \text{currentSize}(u)$ | saturatingRational(raw, 3) | $[0, 1)$ |
| $t_{23}$ | `cost_life_fraction` | 現在ライフに対する支払い割合 | $\text{lifeCount} / \max(1, \text{selfLife})$ | identity (キャップ 1.0) | $[0, 1]$ |

- **コストが存在しない合法手での値:** 全 4 特徴量が厳密に `0.0`。
- **計算量:** マップ参照による $O(K)$（最大でも数回のメモリアクセス）。

---

## 9. 修正F：同ランク・異スートの扱い（表現限界の明記）

### 9.1 3 つの同値性の区別
手札の `Spade 3` と `Heart 3` の1枚廃棄について、以下を厳密に区別する：

1. **特徴量上の同値:**  
   本 P0 特徴量では、ともに $t_{20} = 3/13$ となり同一値を出力する。
2. **ルール上の同値:**  
   通常のアクションコストとしてはスート指定がない限り等価に支払えるが、特定スートを要求する切札や次手番の召喚条件においては等価ではない。
3. **戦略上の同値:**  
   将来の手札構成（同スートフラッシュ、特定役形成）を考慮すると、どちらを残すかは戦略上等価ではない場合がある。

### 9.2 P0 の表現限界としての位置づけ
本設計において同ランク・異スートを区別しないことは、**「ルール上・戦略上の完全同値」とみなしたからではなく、「P0 特徴量における意図的な表現限界（Abbreviated Representation）」**である。
初期学習の次元数抑制と過学習防止を優先した結果であり、将来スート依存性が重要と判明した場合は P1 特徴量（`cost_discard_suit_multiplicity` 等）として段階的に拡張する。

---

## 10. 修正G：特徴量追加による副作用の整理

### 10.1 2 種類の影響範囲の明確化
新特徴量に非ゼロの重みを設定した場合、影響は以下の 2 つのレベルで発生する。

1. **局所的影響（同一アクション内での支払い対象の選択）:**  
   手札 C3 を捨てるか C8 を捨てるか、Joker を温存するか。
2. **大局的影響（コストありアクションと他アクションの選択）:**  
   コスト特徴量が非ゼロ重みを持つと、**コストを支払うアクション全体のスコアがシフト**する。

### 10.2 想定される重大な副作用リスク
- **Counter 忌避（Counter Reluctance）:**  
  手札廃棄や Joker 消費に対する負のペナルティが強すぎると、相手の致死アタックを打ち消す Counter（コストあり）の総合スコアが低下し、ノーコストの PASS を選んで敗北するリスク。
- **召喚・スペル発動の躊躇:**  
  リソース消費を恐れて手札を抱え込み、盤面展開が遅れるリスク。

### 10.3 対策と受け入れ条件
検証計画において、同一アクション内の同点解消だけでなく、**「相手の致死アタックに対して Counter を正しく選択できるか」「平均ターン数が異常に延伸していないか」**を必須の監視項目とする。

---

## 11. 設計変更履歴 (Revision History)

- **2026-11-10 (R0 / 初版):** Work 5-5A 初回設計。5特徴量（防壁サイズ含む）、25次元拡張案を提示。
- **2026-11-10 (R1 / 本改訂版):**
  1. 防壁ユニットの `currentSize` が観測仕様上 `undefined` であることを確認し、防壁特徴量を P0 から除外（P1 延期）。P0 を **4 特徴量（全24次元）** へ確定。
  2. `fromV6CompatibleDNA()` において、旧 20 次元 DNA を R4 プリセットで上書きせず、元の 20 重みを完全維持して末尾 4 つを `0.0` パディングする移行仕様を策定。
  3. 新 Encoder Version `v7.3-cost-evaluated-v24` を新設し、旧形式との対応関係を定義。
  4. Joker 正規化を複数枚対応の飽和有界関数（案2）へ確定。
  5. ID 解決失敗時の 3 状態区分（KNOWN / HIDDEN / INVALID_REFERENCE）を定義し、Joker 値 0 との混同を排除。
  6. 同ランク異スートの同値を「P0 の表現限界」として明確に位置づけ。
  7. コストありアクション全体への副作用（Counter 忌避等）を明記し、検証指標に反映。
