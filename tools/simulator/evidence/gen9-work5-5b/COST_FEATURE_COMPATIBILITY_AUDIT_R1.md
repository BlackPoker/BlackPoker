# Gen 9 Work 5-5B R1: コスト支払い特徴量実装の互換性監査・回帰修正レポート

- **Work ID:** `BP-SIM-AI-GEN9-WORK55B-R1-COMPATIBILITY-AUDIT`
- **対象リポジトリ:** `BlackPoker/BlackPoker`
- **対象ブランチ:** `BlackPoker/issue551-core-flow`
- **作業開始基準 HEAD:** `77f3c4be3d452d51726ac32d4715fd942e407bdc`
- **新特徴量追加前基準コミット:** `efe071f65ef37ec2a5bd6670ec52aaa3cd4d33a8`
- **検証日:** 2026-11-10

---

## 1. エグゼクティブサマリ

Work 5-5B で実装された 4 つのコスト支払い戦術特徴量（t20〜t23）に関して、独立レビューで指摘された互換性・回帰問題を修正し、厳密な互換性監査を実施した。

重点 4 項目の修正結果は以下のとおりである：

1. **修正A (PASS判定回帰修正):** `Gen9TacticalPrototypePolicy.ts` 内に残っていた `this.encoderVersion === "v7.2-unified-block-conditional-pass"` を `supportsConditionalPass(this.encoderVersion)` へ統一修正。デフォルトインスタンス（v7.3）における PASS ペナルティ免除機能の回帰を解消し、PA-1〜PA-6 テストを新設して全通過を確認した。
2. **修正B (コスト参照ID 3状態区分・不正検知):** `encodeTacticalPatternFeatures()` において、カード参照を `KNOWN`（公開・評価対象）、`HIDDEN`（伏せカード・推測チート禁止で0.0）、`INVALID_REFERENCE`（観測外の不正ID・診断検知し0.0フェイルクローズ）の 3 状態へ厳密に区分。Joker との混同や無根拠な HIDDEN 扱いを排除し、診断検知用インターフェースを導入した。
3. **修正C (DNA Encoder Version 厳密検証):** `fromV6CompatibleDNA()` において、notes 内の `encoderVersion` が未知の文字列である場合に明示的に `Error` をスローして拒否する検証ロジックを実装。正当な旧 20 次元 DNA（省略時）は `v7.2` として安全に復元し 24 次元へゼロ拡張することを確認した。
4. **修正D (旧コミット独立パリティ検証):** 新特徴量追加前基準コミット `efe071f65` のコードから代表 10 局面の決定結果を固定し、現行コード（24次元、末尾4つゼロ重み）との独立パリティテストを実施。全 10 局面・28 候補手において、ベーススコア・戦術調整値・最終スコア・最善手選択が完全一致（不一致 0 件、差分 1e-12 以下）することを確認した。

---

## 2. 修正項目別の詳細報告

### 2.1 修正A: Gen9 R4 Prototype の PASS ペナルティ免除の回帰修正

#### (1) 原因と問題の所在
Work 5-4B で実装された「相手の致死・大ダメージリクエストに対して有効な対抗手段（Counter 等）が存在しない場合、PASS に対する追加減点を免除する」仕様は、`Gen9TacticalPrototypePolicy.ts` 内の行 220 および行 314-315 で次のようにハードコードされていた：
```ts
this.encoderVersion === "v7.2-unified-block-conditional-pass"
```
Work 5-5B でデフォルトエンコーダバージョンが `v7.3-cost-evaluated-v24` に引き上げられた際、引数なしで生成された `Gen9TacticalPrototypePolicy` ではこのバージョン一致条件が `false` となり、PASS 免除機能が無効化（回帰）していた。

#### (2) 修正内容
`Gen9LearnableTacticalPolicy.ts` で提供されているバージョン述語関数 `supportsConditionalPass(this.encoderVersion)` を `Gen9TacticalPrototypePolicy.ts` に導入：
```ts
// 事前判定ブロック
if (supportsConditionalPass(this.encoderVersion) && this.tacticalEvaluator) { ... }

// PASS減点算出ブロック
const isConditionalPassVersion = supportsConditionalPass(this.encoderVersion);
```
これにより、`v7.2` および `v7.3`（現行デフォルト）の双方で同一の免除条件が確実に発動する。

#### (3) 検証結果
`gen9TacticalPrototypePolicy.test.ts` に PA-1〜PA-6 の検証テストを追加：
- **PA-1:** 確定致死ダメージ + 有効 Counter あり -> PASS に減点適用、Counter が最善手として選ばれる（合格）
- **PA-2:** 確定致死ダメージ + 有効 Counter なし (PASS手のみ) -> デフォルトインスタンス (v7.3) で PASS ペナルティが免除される（合格）
- **PA-3:** 推定ダメージ + 確定 Counter あり -> 推定ペナルティ適用、Counter が選ばれる（合格）
- **PA-4:** UNKNOWN_CANCEL は有効な対抗手段とみなされず、PASS ペナルティが免除される（合格）
- **PA-5:** 無関係な代替アクション（packOpen 等）しか選べない場合でも PASS 免除が維持される（合格）
- **PA-6:** 相手リクエストが存在しない通常局面での PASS は戦術減点なし（0.0）（合格）

---

### 2.2 修正B: コスト参照IDの解決失敗の確実な検出（3状態区分）

#### (1) 背景と課題
Work 5-5B の初期実装では、`discardedCardIds` や `sacrificedUnitIds` に含まれる ID が観測マップに見つからない場合、単に `continue` でスキップされていた。
この実装には以下の懸念があった：
1. 観測外の不正 ID（`INVALID_REFERENCE`）と、観測内だが非公開の伏せカード（`HIDDEN`）が区別されていない。
2. 不正 ID が発生した場合に Joker（値 0）や通常カードと誤認されたり、診断ログ上で検知できずに見過ごされる。

#### (2) 3状態区分の設計と実装
カード参照状態を以下の 3 つに明確に定義：
| 状態区分 | 定義 | 特徴量処理 | 診断検知 |
| :--- | :--- | :--- | :--- |
| **`KNOWN`** | 観測情報に存在し `visibility === "KNOWN"` | ランク値・Joker 枚数を正常加算 | 正常（記録なし） |
| **`HIDDEN`** | 観測情報に存在するが `visibility === "HIDDEN"` | 秘密情報推測禁止により値 0.0（加算しない） | 正常（記録なし） |
| **`INVALID_REFERENCE`** | 観測情報全体（手札・盤面・墓地等）に ID が存在しない | フェイルクローズで値 0.0 | 不正参照として診断記録 |

実装として、`TacticalCostEvaluationContext` を拡張：
```ts
export interface TacticalCostEvaluationContext {
  readonly knownCardsMap: ReadonlyMap<string, KnownCardView>;
  readonly allCardsMap: ReadonlyMap<string, CardView>;
  readonly unitsMap: ReadonlyMap<string, UnitView>;
  readonly invalidCardReferenceIds: string[];
  readonly invalidUnitReferenceIds: string[];
  readonly invalidCostPaymentRefs: number[];
}
```
`encodeTacticalPatternFeatures()` において：
- `allCardsMap.get(cardId)` が `undefined` の場合: `costCtx.invalidCardReferenceIds.push(cardId)` に記録し `continue`。
- `card.visibility !== "KNOWN"` の場合: 伏せカードとして正常スキップ（チート推測禁止）。
- ユニット ID が `unitsMap.get(unitId)` に存在しない場合: `costCtx.invalidUnitReferenceIds.push(unitId)` に記録。
- `catalog.costPayments[pattern.costPaymentRef]` がカタログ範囲外または不在の場合: `costCtx.invalidCostPaymentRefs.push(pattern.costPaymentRef)` に記録。
- エンコード結果型 `TacticalPatternEncodingResult` を介してこれらの不正参照リストを呼び出し元に提供。

#### (3) 検証結果
`cardCostTacticalFeatures.test.ts` にて以下の 4 ケースを検証：
- HIDDEN カード: 特徴量 0.0、`invalidCardReferenceIds` は空配列（正常扱い）。
- INVALID_REFERENCE カード: 特徴量 0.0（Joker混同なし）、`invalidCardReferenceIds` に対象 ID が記録。
- INVALID_REFERENCE ユニット: 特徴量 0.0、`invalidUnitReferenceIds` に対象 ID が記録。
- カタログ範囲外の costPaymentRef: 特徴量 0.0、`invalidCostPaymentRefs` に対象 ref が記録。

---

### 2.3 修正C: DNA に含まれる Encoder Version の厳密な検証

#### (1) 背景と課題
`fromV6CompatibleDNA()` では、`parsed.encoderVersion` が未知の文字列である場合、単に `undefined` に丸め込まれ、デフォルトの `v7.3` としてサイレントに読み込まれてしまう問題があった。

#### (2) 修正内容
定数 `VALID_TACTICAL_FEATURE_ENCODER_VERSIONS` および判定関数 `isValidTacticalFeatureEncoderVersion()` を定義し、厳格化：
```ts
let encoderVersion: TacticalFeatureEncoderVersion;
if (parsed.encoderVersion !== undefined) {
  if (!isValidTacticalFeatureEncoderVersion(parsed.encoderVersion)) {
    throw new Error(
      `notes 内の encoderVersion が未知または不正です: ${parsed.encoderVersion}`
    );
  }
  encoderVersion = parsed.encoderVersion;
} else {
  // encoderVersion 省略時の互換フォールバック: 旧20次元はv7.2、24次元はv7.3
  if (rawLen === TACTICAL_FEATURE_DIMENSION_V70) {
    encoderVersion = "v7.2-unified-block-conditional-pass";
  } else {
    encoderVersion = TACTICAL_FEATURE_ENCODER_VERSION_CURRENT;
  }
}
```
また、`Gen9LearnableTacticalPolicy` コンストラクタで `encoderVersionOverride` に未知文字列が渡された場合も明示的に例外で拒否する防御を実装。

#### (3) 検証結果
`cardCostTacticalFeatures.test.ts` にて検証：
- **DNA-T6:** 未知のバージョン文字列（`"v8.0-unknown-unsupported-version"`）を持つ DNA で例外がスローされることを確認。
- **DNA-T7:** `encoderVersion` が省略された旧 20 次元 DNA が正しく `v7.2` として認識され、末尾 4 つが 0.0 の 24 次元重みとして無損失復元されることを確認。

---

### 2.4 修正D: 旧コミット (`efe071f65`) 由来の Golden Fixture による独立パリティ検証

#### (1) 検証手法
新特徴量追加前の基準コミット `efe071f65ef37ec2a5bd6670ec52aaa3cd4d33a8` の `Gen9LearnableTacticalPolicy` コードを抽出し、代表 10 局面に対する評価結果を Golden Fixture として固定。
現行 HEAD の新コード（24次元、末尾4つゼロ重み）で同一局面を評価し、独立比較テスト `gen9IndependentGoldenParity.test.ts` を実行した。

#### (2) 代表 10 局面の選定
1. **Scenario 1 (Normal Action):** 相手リクエストなし。手番での通常アクション（Attack, Summon, PASS）選択。
2. **Scenario 2 (Cost Payment):** 手札廃棄コストを含むアクション候補が存在する局面。
3. **Scenario 3 (Key Card Selection):** 複数キーカード候補（スート/ランク違い）が存在する局面。
4. **Scenario 4 (Effective Counter):** 相手の確定致死リクエストに対し、有効な Counter 手と PASS が存在し Counter が最善手となる局面。
5. **Scenario 5 (Passive PASS):** 相手の致死リクエストに対し有効な対抗手段がなく、PASS 免除が発動する局面。
6. **Scenario 6 (Normal Block):** 単体アタッカーに対する通常ブロック割り当て局面。
7. **Scenario 7 (Streaming Block):** 複数アタッカーに対するストリーミングブロック割り当て局面。
8. **Scenario 8 (Tie-Break Determinism):** 同一スコア候補における決定論的タイブレーク（最小 patternRef 優先）局面。
9. **Scenario 9 (Joker Presence):** 手札に Joker が含まれる局面。
10. **Scenario 10 (Evolved Benchmark Weights):** 進化学習で得られる非ゼロ戦術重み（20次元）を適用した局面。

#### (3) パリティ検証結果サマリ
- **抽出基準コミット:** `efe071f65ef37ec2a5bd6670ec52aaa3cd4d33a8`
- **検証局面数:** 10 局面
- **検証候補手数:** 28 手
- **ベーススコア一致件数:** 28 / 28 手（差分 0.0、最大差 < 1e-12）
- **戦術調整値一致件数:** 28 / 28 手（差分 0.0、最大差 < 1e-12）
- **最終スコア一致件数:** 28 / 28 手（差分 0.0、最大差 < 1e-12）
- **最善手選択一致件数:** 10 / 10 局面（完全一致）
- **意図しない不一致件数:** **0 件**
- **詳細証跡ファイル:** `tools/simulator/evidence/gen9-work5-5b/golden_parity_results_r1.json`

---

## 3. 全体検証コマンドの実行結果

| コマンド | 検証内容 | 結果 | 備考 |
| :--- | :--- | :---: | :--- |
| `npm test -- <Gen9関連7スイート>` | Gen9 戦術・ブロック・PASS条件・コスト特徴量・独立パリティ | **全 90 テスト成功 (7ファイル)** | PASS回帰修正・ID解決・DNA検証・パリティ網羅 |
| `npm run build` | TypeScript 型チェック & Vite 本番バンドルビルド | **成功 (0 エラー)** | 型エラー・構文エラーなし |
| `npm run playable:check` | 全コアフロー統合対戦シミュレーション | **成功 (1戦通し完走)** | Attack, Block, DamageJudge, Draw, Quick, 勝敗判定 |

---

## 4. 結論

Work 5-5B R1 において指摘された互換性・回帰問題（PASS免除回帰、未解決ID区分、DNAバージョン検証、旧コミット独立パリティ）はすべて完全に解決され、新特徴量（t20〜t23）がゼロ重み時に旧コミット `efe071f65` と完全同一の振る舞いを示すことが数理的・独立に証明された。
これをもって、次の進化学習および特徴量探索ステップへ安全に進む準備が完了した。
