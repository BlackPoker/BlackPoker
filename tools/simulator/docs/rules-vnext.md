# 新ルールYAML DSL 移行検証 実装メモ

本ドキュメントは、BlackPoker のルール定義形式を将来的に統一・近代化するための「新ルールYAML DSL」のテスト実装および移行検証に関する設計メモです。
既存の公式 `act.yaml` / `act-frame.yaml` や、それらから RST ドキュメントなどを自動生成する処理には影響を与えない形で、プロトタイプシミュレーター（`tools/simulator`）内でのみクローズドに検証を行いました。

## 1. 設計方針と基本原則

- **既存定義を壊さない・急激な置換は行わない**
  既存の `act.yaml` や `act-frame.yaml`、およびそれらをパースする Maven / RST 生成パイプラインは一切変更せず、独立した移行プロトタイプとして `tools/simulator` 内で構築します。
- **日本語の効果・能力テキストが正本**
  BlackPoker ルールにおいては、日本語の自然言語によるテキスト効果が最上位の裁定基準（正本）です。
- **YAMLは実行可能な正本候補**
  新YAML DSLは、日本語の自然言語効果テキストと、機械実行可能な高レベル「効果（effect）」や「能力（abilities）」を単一ファイルで定義できるようにし、将来的に「実行可能な正本」となることを目指します。
- **低レベルIRは手管理しない**
  新YAMLからロード・コンパイルされ内部で構築される中間表現（IR）は、ファイルとして手管理せず、ローダーによって動的に生成され、シミュレーターエンジンに提供されます。
- **高レベル命令は Command Registry で解釈する**
  `createFog` や `summonUnit` のような高レベルのカード効果・能力命令は、`CommandRegistry` を介して一元的に解釈・実行されます。これにより、将来的に Rust 実装等の別言語・別プラットフォームへ移植する際にも、低レベルIR命令への展開を1箇所に集約して行える設計になっています。
- **旧生成処理との比較準備**
  本フェーズでは自動生成された短縮表記との完全一致までは求めませんが、将来の比較が容易になるよう、アクション情報から短縮サマリー（例: `アップ @直接-通常-クイック | $D | ★♡A-10 | 対象: 兵士1体`）を自動生成する `formatActionSummary` ユーティリティを実装しています。

## 2. ディレクトリ・ファイル構成

実装したモジュールとディレクトリ構造は以下の通りです：

```text
tools/simulator/
  ├── docs/
  │    └── rules-vnext.md                      # 本実装メモ（日本語）
  └── src/
       ├── data/
       │    └── rules-vnext/                   # 新YAML定義の配置場所
       │         ├── blackpoker-common.yaml    # 共通パッケージメタデータ
       │         ├── official-base.yaml        # 一般兵、アップフォグのコンポーネント定義
       │         └── examples/
       │              ├── up.yaml              # アップのアクション・効果定義
       │              ├── summon-soldier.yaml  # 兵士召喚のアクション・効果定義
       │              └── next-generation.yaml # 世代交代のプレースホルダ
       ├── domain/
       │    └── rules/
       │         └── RulePackage.ts            # DSLに対応するTypeScript型定義
       ├── engine/
       │    └── rules/
       │         ├── RuleLoader.ts             # YAMLパーサーと簡易バリデーター
       │         ├── CommandRegistry.ts        # 高レベル命令（createFog / summonUnit）の実行エンジン
       │         └── formatActionSummary.ts    # 新DSLから短縮表記（サマリー）を生成するユーティリティ
       └── tests/
            └── rules-vnext/                   # 移行検証用 Vitest 統合テスト
                 ├── up.test.ts                # アップアクションおよびフォグ効果の検証テスト
                 └── summonSoldier.test.ts     # 兵士召喚および一般兵コンポーネントの検証テスト
```

## 3. 各実装モジュールの詳細

### 型定義 (`RulePackage.ts`)
TypeScript にて `RulePackage`, `ActionDefinition`, `ComponentDefinition`, `EffectCommand` の型を定義しました。将来の移植性を意識し、各境界と責務が明確になるようモデル化されています。

### ローダー (`RuleLoader.ts`)
- TypeScript標準の `yaml` ライブラリを採用し、指定したディレクトリ以下の YAML ファイルを再帰的にロードして1つの `RulePackage` にマージします。
- Vite (ブラウザ環境) ビルドを破壊しないよう、Node.jsの `fs` や `path` モジュールのインポートは動的インポート (`await import(...)`) を用いてカプセル化しています。
- 重複する `action.id` や `component.id` の検出による簡易バリデーションを備えています。

### コマンドレジストリ (`CommandRegistry.ts`)
高レベル効果をシミュレーターに対して適用するための実行レジストリです。本検証では、以下の2つの命令をサポートしています。
1. `createFog`: 指定されたフォグ（`fog.up`）を対象の一般兵ユニットにバインド（`binding.target`, `binding.amount` を解決）してプレイヤーのフォグ領域に配置します。
2. `summonUnit`: 手札からキーカードを消費し、指定されたコンポーネントテンプレート（`character.soldier`）に基づき、チャージ状態の一般兵ユニットを場（フィールド）に召喚します。

### サマリーフォーマッター (`formatActionSummary.ts`)
YAML定義にある `request`、`cost`、`key` 条件、`targets` 条件から、旧 system で使われていた短縮表記フォーマットに沿った文字列を自動生成します。

---

## 4. 検証結果と今後への道筋

### テストおよびビルドの検証
以下のテストとビルドが Docker 開発環境内で正常に動作することを確認しました。
```bash
# テストの実行 (Vitest)
docker compose run --rm app npm test
# 結果: 6 passed (6) - すべてのテストにパス

# 本番ビルドおよび型チェック
docker compose run --rm app npm run build
# 結果: built in 1.47s - 既存のUIコードや設定を全く壊さず、ビルドが成功
```

### 次ステップに向けた考察
- **アビリティの動的解決**: `up.test.ts` で実証したように、一般兵に適用された `fog.up` の `sizeModifier` 能力を、バインド情報から動的にサイズ値に反映させることが可能となりました。
- **YAML形式の表現力検証**: ルールの定義、テキスト、機械的効果、コスト、条件などを1ファイルで高い表現力で定義できることが確認できました。今後はさらに複雑な「世代交代」や「イベント・誘発」などの複雑なカード効果へと定義を拡張することが可能です。

---

## 5. Phase 2 検証結果: 条件分岐 (if) と動的リソース操作

Phase 2 では、より複雑な効果処理の検証として「ダウン」アクションを追加し、以下の機構について実証を行いました。

### 条件付き効果の実行 (`if` 制御構文)
効果適用後に特定の条件（例: `target.size <= 0`）を判定し、それに基づいて高レベル命令を実行する仕組みを `CommandRegistry` に導入しました。

```yaml
    effect:
      - createFog:
          component: fog.down
          card: key
          bindings:
            target: target
            amount: -key.rankValue
      - if:
          condition: "target.size <= 0"
          then:
            - moveToGraveyard:
                target: target
            - removeFog:
                component: fog.down
                target: target
```

### 高レベル命令の追加
- `moveToGraveyard`: 対象ユニットをフィールドから除外して墓地（`grave`）へと移動させる。
- `removeFog`: 特定のフォグ（`fog.down`）をフォグ領域から除去する。

### 検証内容 (`down.test.ts`)
- **ケースA (♠2適用 / サイズ5の兵士)**
  - ♠2 (rankValue: 2) を適用すると、バインディングを通じてサイズが `-2` され、最終サイズが `3` に減少することを確認。
  - サイズが0より大きいため、兵士はフィールドに残り、作成されたダウンフォグも維持されることを検証。
- **ケースB (♠5適用 / サイズ5の兵士)**
  - ♠5 (rankValue: 5) を適用するとサイズが `0` になり、`if` 条件分岐が真と評価されることを確認。
  - 兵士が自動的に墓地 (`grave`) へ移動し、作成された `fog.down` がフォグ領域から即座に除去されて残らないことを検証。

これにより、状態変化に応じた動的なカード効果や連鎖処理が、新YAML DSLによって明確かつ簡潔に表現でき、実行エンジンが正しく解釈可能であることが証明されました。

---

## 6. Phase 2.5 検証結果: 実行エンジンの責務分離（リファクタリング）

今後の Phase 3 （世代交代、要塞、誘発等）に向けた拡張性の確保、および保守性向上を目的として、`CommandRegistry.ts` に集中していたロジックを責務ごとに各専用モジュールへと分離・クリーンアップしました。

### 分離されたモジュールの設計と責務
1. **`CommandRegistry.ts` (軽量化)**
   - 責務：コマンド名とハンドラー（`CommandHandler`）の登録および解決。
   - `ExpressionEvaluator` などのインスタンスを管理し、`commandHandlers.ts` に実装された個別ハンドラーを起動時に登録します。
   - **後方互換性（ファサード）**: 既存のテストコードや呼び出し側への破壊的変更を防ぐため、ブリッジメソッド（`calculateUnitSize`, `executeEffects`）をデリゲート（移譲）する形で維持しています。
2. **`ExpressionEvaluator.ts` (新規作成)**
   - 責務：条件式（例: `target.size <= 0`）の判定評価、およびバインディングされたキーカードの値解決（`key.rankValue`, `-key.rankValue` 等）。
3. **`AbilityEvaluator.ts` (新規作成)**
   - 責務：ゲーム状態における各種能力効果の集計（フォグ効果の `amount` 累積を反映したユニットサイズ計算など）。
4. **`EffectInterpreter.ts` (新規作成)**
   - 責務：効果コマンドリストの順次実行フロー、および `if-then-else` 等の制御ロジックの判定・フロー実行制御。
5. **`commandHandlers.ts` (新規作成)**
   - 責務：個別効果コマンド（`createFog`, `summonUnit`, `removeFog`, `moveToGraveyard`）の具体的な状態更新ロジックの実装。

### リファクタリング検証結果
本構成への分離後も、既存の `up.test.ts`, `down.test.ts`, `summonSoldier.test.ts` を含む**すべての Vitest テスト（計10ケース）が一切のコード修正なしで 100% 正常に通過**し、ビルドも正常終了することを確認しました。

これにより、高レベル命令実行エンジンの機能拡張とメンテナンス性が大幅に向上し、Phase 3 以降の複雑なルール実装に向けたクリーンな土台が確立されました。

---

## 7. Phase 3 検証結果: イベント・トリガー（誘発アクション）と「世代交代」の実装

Phase 3 では、イベントと誘発（triggered）アクションのモデル設計の検証として、「世代交代」を実装し、即時解決モデルの評価を行いました。

### イベント・トリガー（誘発）の最小モデル
- **イベント定義 (`GameEvent`)**
  ゲーム状態の更新時に、何が起きたか（例: カード移動イベント `cardMoved`）を伝える以下の最小限のデータモデルを構築しました。
  ```typescript
  {
    type: "cardMoved",
    payload: {
      card: any,
      fromZone: "field",
      toZone: "grave",
      playerKey: "p1"
    }
  }
  ```
- **イベントのディスパッチと評価 (`EffectInterpreter.ts`)**
  `EffectInterpreter` に `dispatchEvent` メソッドを実装し、登録されたアクションの中から `triggered` アクションを探索、`evaluateTrigger` によりイベントの条件判定（`fromZone`, `toZone`, `card.rank`, `card.owner` など）に合致するアクションをその場で即時に実行（即時解決モデル）する仕組みを構築しました。
- **既存コマンドでのイベント発行**
  `moveToGraveyardHandler` の内部から `EffectInterpreter.dispatchEvent` を呼び出し、場から墓地へ移動した各カードに対して `cardMoved` イベントを動的にディスパッチするよう拡張しました。

### 「世代交代」アクションの YAML 定義
`examples/next-generation.yaml` のプレースホルダを、以下のように実行可能な誘発アクションとしてアップデートしました。

```yaml
actions:
  - id: action.nextGeneration
    name: 世代交代
    type: triggered
    request:
      trigger: triggered
      speed: immediate # 即時解決
      timing: always
    triggerCondition:
      event: cardMoved
      condition:
        fromZone: field
        toZone: grave
        card:
          rank: ["Joker", "A", "J", "Q", "K"]
          owner: self
    effect:
      - takeUntilLegacyCard:
          player: self
```

### 高レベル命令 `takeUntilLegacyCard` の実装
今回の実装負荷および DSL 表現力を考慮し、高レベル命令 `takeUntilLegacyCard` として実装しました。
- プレイヤーのライフ（`life`）の上から1枚ずつめくり、`Joker,A,J,Q,K` 以外なら墓地に送り、該当カードが出たら手札に加えて処理を終了します（ライフが尽きた場合もそこで終了）。
- **将来的な repeatUntil への分解可能性**:
  今回は高レベル命令として処理を集約しましたが、将来的に YAML DSL 側に汎用ループ処理構文 `repeatUntil` や汎用移動命令が導入された場合、次のように YAML 側だけで同等のロジックを構成できるように分解・拡張が可能です。
  ```yaml
  effect:
    - repeatUntil:
        condition: "drawnCard.rank in ['Joker', 'A', 'J', 'Q', 'K'] || player.life.isEmpty"
        do:
          - drawCard: { from: life, id: drawnCard }
          - if:
              condition: "drawnCard.rank not in ['Joker', 'A', 'J', 'Q', 'K']"
              then:
                - moveToGraveyard: { card: drawnCard }
              else:
                - addToHand: { card: drawnCard }
  ```

### テストおよび検証結果 (`nextGeneration.test.ts`)
Vitest により以下の 4 つのケースがすべて 100% 期待通り正常にパスすることを確認しました。
- **ケースA (めくり手札追加)**: 場の J が墓地に移ると世代交代が誘発、ライフ `[ 2, 7, K, Joker ]` からめくり、正常に normal カードを墓地へ送り、`K` を手札に加えて終了すること。
- **ケースB (非誘発)**: 場の普通のカード (2〜10) が墓地に送られた場合は誘発しないこと。
- **ケースC (同時・複数誘発)**: 場の J と Q が同時に墓地へ移った際、カード枚数分（2回）誘発が走り、それぞれ正常にライフをめくること。
- **ケースD (ライフ枯渇)**: ライフに対象カードが無い場合、めくったカードをすべて墓地に移して終了すること。

### 将来のイベント連鎖（ループ防止）に関する方針
本検証では、世代交代によってめくられたカードが墓地に落ちる際の `cardMoved` イベントは、最小実装のため追加の「世代交代」を再帰的に誘発させない（無限ループ防止など）シンプルな制御としています。
将来的にイベント連鎖を実装する際は、「1つの効果解決中に発生したイベントはステージ上のキューに積まれ、同一アクションの二重発火は防止される」などの状態スタック制限（またはイベントソースが `life` から `grave` の場合は誘発条件 `fromZone: field` に合致しないため自然に連鎖が切れるといった、トリガー条件の厳密化）によって安全に制御する方針です。

---

## 8. CommandRegistry のブリッジメソッドの位置づけ

`CommandRegistry.ts` に残されている `calculateUnitSize`, `executeEffects`, `dispatchEvent` といったメソッドは、既存の Vitest 統合テストコード、あるいは将来的な UI からの呼び出しに対する後方互換性を 100% 担保するための**ファサード・ブリッジメソッド**として機能しています。
これらにより、内部構造がどれだけクリーンに責務分離されても、外部のインターフェースを変更することなく、安全にシステムを運用できる設計になっています。

---

## 9. Phase 4 検証結果: 防壁コンポーネントと防壁破壊、複数キーカード条件の実装

Phase 4 では、新しいコンポーネント「防壁」、アクション「防壁破壊」、および複数キーカードを扱う条件定義の拡張について検証を行い、以下の設計・実装方針を確立しました。

### 防壁コンポーネントの定義
`official-base.yaml` に `character.bulwark`（防壁）を追加しました。
防壁は場（field）に裏向き（face: down）で置かれ、防壁を表すメタプロパティ（characterType: bulwark）と防御用属性（labels: [defense]）を持ちます。

```yaml
  - id: character.bulwark
    name: 防壁
    ruby: ぼうへき
    type: character
    zone: field

    unitCondition:
      cards:
        count: 1
        suit: ["heart", "diamond"]
        rank: "A..K"
      face: down

    properties:
      characterType: bulwark
      labels: [defense]

    text:
      summary: ♡A〜Kと♢A〜Kのカードは防壁として扱う。
```

### 複数キーカード条件の表現とサマリーの生成
防壁破壊のように、複数のキーカード（♡A〜K と ♢A〜K の2枚）を前提とするアクションに対応するため、YAML DSL の `key` 定義を拡張し、複数条件（`conditions` 配列と `count`）を記述できるようにしました。

```yaml
    key:
      id: keys
      count: 2
      conditions:
        - card:
            suit: heart
            rank: "A..K"
            zone: hand
        - card:
            suit: diamond
            rank: "A..K"
            zone: hand
```
これに伴い、`formatActionSummary` を拡張し、複数キーカード条件がある場合には `★♡A-K + ♢A-K` のような文字列表記を自動生成できるようにしました。また、防壁がターゲットとなる場合に `対象: 防壁1体` という短縮表記の生成に対応させました。
これにより、防壁破壊アクションから期待される以下の短縮サマリーが正確に生成されることを実証しました。
`防壁破壊 @直接-通常-メイン | ★♡A-K + ♢A-K | 対象: 防壁1体`

### ターゲット条件判定の集約
対象選択時の検証ロジックを整理し、`ExpressionEvaluator.ts` にターゲット判定用メソッド `evaluateTargetCondition(target, condition)` を実装しました。これにより、ターゲットの `component` 条件（例: `character.bulwark` または `character.soldier`）と、対象となる実際のユニットの `componentId` が合致するかを評価エンジンで一元管理できるようになりました。これにより、テストコード上において一般兵が防壁破壊の対象に選ばれないこと（条件不適合）を簡潔かつ厳密にアサート可能です。

### 防壁破壊と「世代交代」イベントの連携
防壁破壊（`moveToGraveyard`）により、防壁ユニットが場から墓地へ移動した際にも、構成カードに対して `cardMoved` イベントが発生する設計を実証しました。
- **世代交代の連鎖**:
  防壁を構成するカードが `Joker, A, J, Q, K`（Legacy Card）である場合（例: ♡K や ♢A など）、`cardMoved` イベントを通じて「世代交代（`nextGeneration`）」が正しく誘発され、ライフが正常にめくられて手札追加が行われます。
- **対象外カードでの不誘発**:
  防壁の構成カードが Normal Card（例: ♡6）である場合には、イベントが発行されても世代交代の誘発条件に適合しないため、無用な連鎖が発生せず安全に処理が終了することを確認しました。

これにより、領域移動に伴うイベントモデルが防壁のような裏向きのコンポーネントでも一般兵と同様に統一的に機能することが実証され、将来の「要塞」や「ダメージ判定」の実装に向けた堅牢な土台が整いました。

---

## 10. Phase 5 検証結果: 投擲と dealDamage、複数キーカードのスート別数値解決の実装

Phase 5 では、新ルールYAML DSLにおいて「投擲」アクションを定義し、プレイヤーへダメージを与える `dealDamage` コマンド、複数キーカードにおける特定スート（スペード）の数値解決、およびライフからのダメージ移動と「世代交代」イベントとの連携（不誘発）制御について検証を行いました。

### 複数キーカードからの特定スートの数値解決
「投擲」アクションでは、キーカードとして ♠A〜K と ♣A〜K の2枚を必要としますが、与えるダメージ X は「キーカードの ♠カード の数字」に等しくなります。
これを実現するため、`CommandContext` を拡張し、複数キーカードの情報を保持する `keyCards` プロパティを追加しました。また、`ExpressionEvaluator` を拡張し、`keyCards.spade.rankValue` のようなスート指定の rankValue 参照を動的に解決する仕組みを実装しました。

```typescript
      if (value === "keyCards.spade.rankValue" && context.keyCards) {
        const spadeCard = context.keyCards.find(
          (c: any) => c.suit === "S" || c.suit === "spade" || c.suit?.toLowerCase() === "spade"
        );
        return spadeCard ? spadeCard.value : 0;
      }
```
これにより、入力されたキーカードのスーツと値を柔軟に参照し、効果パラメータに解決できるようになりました。

### `dealDamage` コマンドハンドラーとダメージによるカード移動
プレイヤーにダメージを適用するための高レベル効果コマンド `dealDamage` を `commandHandlers` に新規実装しました。
- **処理フロー**:
  1. `ExpressionEvaluator` を用いて、ダメージ量（`amount`）を解決します。
  2. 対象プレイヤーのライフ（`life`）領域の上から `amount` 枚のカードを順に墓地（`grave`）へと移します。
  3. 移動したカードを、墓地内で「ダメージ」という種類のカードオブジェクトとして配置します。
  4. 各カードの移動ごとに、`cardMoved` イベントを `EffectInterpreter.dispatchEvent` を介して動的にディスパッチします。このとき、移動元（`fromZone`）は `"life"`、移動先（`toZone`）は `"grave"` となります。

### ダメージ移動と「世代交代」の連携（不誘発）の保証
ダメージによって墓地に移動したカードの中に `Joker, A, J, Q, K`（Legacy Card）が含まれる場合でも、「世代交代」アクションは**一切誘発しない**ことを保証しました。
- **論理的なループ/連鎖防止**:
  「世代交代（`nextGeneration`）」の誘発条件（`triggerCondition`）には、`fromZone: field`（場から墓地へ移る）と明記されています。ダメージ処理による移動は `fromZone: life` となるため、イベントが発生しても誘発条件に適合せず、正しく無視されます。
- **検証実績**:
  テストにおいて、相手のライフ上から Legacy Card である `K` が墓地へ送られた際にも、世代交代が走ることなく安全にダメージ処理のみが完了することを厳密に実証しました。

### サマリー表記のパース拡張
`formatActionSummary` を拡張し、ターゲット条件が `type: player` かつ `relation: opponent` である場合、`対象: 対戦相手1人` とパースできるようにしました。これにより、以下の期待される短縮サマリーの自動生成を実証しました。
`投擲 @直接-通常-メイン | ★♠A-K + ♣A-K | 対象: 対戦相手1人`

### 将来の「要塞」におけるダメージ軽減レイヤー（`damagePrevention`）の拡張予定
本フェーズで確立した `dealDamage` のフローは、将来「要塞コンポーネント」や「常時適用アビリティ（オーラ）」を導入した際に、ダメージ軽減や防壁による身代わり効果（`damagePrevention` レイヤー）を柔軟に挟み込むことが可能です。
ダメージを与える直前に、プレイヤーが持つアビリティ（例: `preventDamage` や `interceptDamage`）を `AbilityEvaluator` で走査・評価し、適用するダメージの `amount` を減算、または肩代わりさせる防壁ユニットを特定するイベントハンドリング構造へと自然に拡張できる設計となっています。

---

## 11. Phase 5.5 検証結果: ActionRequestValidator とリクエスト事前検証の実装

Phase 5.5 では、アクション実行前にキーカード条件やターゲット（対象）条件を厳密にバリデーションする `ActionRequestValidator` を追加し、不正なアクションが効果解決まで進まないようにする「リクエスト事前検証（Request Validation）方針」の実証を行いました。

### ActionRequestValidator の責務と検証ロジック

新YAML DSLから実行されるアクション全体において、効果（effect）の解決を試みる前段で、リクエストがルールで定義された制約をすべて満たしているかを検証する役割を持ちます。

1. **キーカード枚数検証 (`key.count`)**:
   - 入力された実際のキーカード枚数（`keyCards` / `keyCard`）が、アクション定義で要求される枚数と一致しているかチェックします。
2. **キーカード条件適合判定 (`key.condition` / `key.conditions`)**:
   - 要求されるスートおよびランク（範囲指定 `"A..K"`, `"2..10"` や配列指定 `["Joker", "A", "J", "Q", "K"]` 等）に実際のカードが適合しているかチェックします。
   - 複数キーカード条件（`conditions`）がある場合は、入力カード群と各条件とが重複なく1対1でペアとして適合すること（全順列探索による厳密一致）を確認します。
3. **ターゲットのコンポーネント条件**:
   - `action.targets` に `component` 条件（例: `character.bulwark`）が指定されている場合、選択された対象（`context.targetComponent`）が存在し、かつその `componentId` が合致するかを `ExpressionEvaluator.evaluateTargetCondition` を介して検証します。
4. **ターゲットプレイヤーの relation 条件**:
   - 対象プレイヤーが `relation: opponent` である場合、ターゲットプレイヤー（`context.targetPlayerKey`）が存在し、かつ実行者プレイヤー（`context.playerKey`）と異なる（対戦相手である）ことを検証します。

これらいずれかの条件に反している場合は、不正なリクエストとして `ValidationError` 例外をスローします。

### 「不正なキーカードは 0 扱いせず、リクエスト不可とする」方針の導入

従来（Phase 5 まで）は、例えば「投擲」アクションにおいてスートの異なるキーカード（例: ♠の代わりに♡）が指定された場合、効果解決段階でダメージ算出値が `0` 点となり、結果として「0ダメージを与える効果」が解決されていました。
本フェーズではこれを見直し、「効果解決の前に、そもそもリクエストの適合性を厳密にバリデーションし、不適合な場合は実行を拒絶（例外をスロー）する」設計に移行しました。
これにより、ルール整合性の保証が効果コマンドの個別ハンドリングから独立し、アクションの解決フロー前段で一元管理されるため、より安全かつ堅牢なルールエンジンを実現できます。

### エンジンへの統合 (`CommandRegistry.ts`)

`CommandRegistry` に以下の高レベル解決メソッドを追加し、事前検証と効果実行のフローをカプセル化しました。

- `validateAction(action, context)`: アクションのリクエスト事前検証を行い、不整合があれば `ValidationError` をスローする。
- `executeAction(action, context)`: `validateAction` による事前検証が正常にパスした後にのみ、登録されている効果（`effect`）を順次実行（`executeEffects`）する。

### 追加・修正された検証ケース

1. **「投擲」におけるスート不適合時の検証エラー判定 (`throwing.test.ts`)**:
   - ♠ を含まない不適切なキーカード（例: ♡5 + ♣2）で「投擲」アクションを解決しようとした（`executeAction` を呼び出した）際に、0ダメージを与えるのではなく、正しく `ValidationError` 例外がスローされるようアサーションを修正・実証しました。
2. **「防壁破壊」におけるキーカード不適合時の検証エラー判定 (`destroyBulwark.test.ts`)**:
   - 防壁破壊（キーカード: ♡A-K + ♢A-K）において、♢ が不足するキーカード（例: ♡5 + ♠2）を伴ってアクションを解決しようとした場合に、正しく `ValidationError` 例外がスローされ、防壁の破壊（墓地移動）が実行されないことを検証しました。

本フェーズの実装により、Vitest 統合テストの全 28 ケースが 100% グリーンでパスし、ビルドも正常終了することを確認しました。
これにより、新ルールYAML DSLに安全かつ厳格な「事前バリデーション機構」が統合され、堅牢な検証レイヤーの基礎が確立されました。

---

## 12. Phase 6 検証結果: 要塞常在能力とダメージ無効化レイヤーの実装

Phase 6 では、新ルールYAML DSLに切札コンポーネント「要塞（`trump.fortress`）」および「常在能力（Static Ability）」、ダメージ無効化レイヤー（`damagePrevention`）を導入し、投擲によるプレイヤーへのダメージを要塞の能力で透過的に防げる仕組みの実証を行いました。

### 要塞コンポーネントと常在能力のYAML定義
`examples/fortress.yaml` を新規作成し、`trump.fortress` のコンポーネント仕様、および `preventDamage` 常在能力を以下のように定義しました。
```yaml
components:
  - id: trump.fortress
    name: 要塞
    ruby: ようさい
    type: trump
    zone: trump
    card:
      suit: club
      rank: "9"
    face: up

    abilities:
      - preventDamage:
          source:
            requestController: opponent
            keyCardsIncludeSuit: spade
          condition:
            exists:
              zone: field
              controller: self
              componentType: character
          target: self
```

### 実行エンジンの拡張と context バインド
1. **`currentAction` によるコンテキストの逆引き**:
   `CommandRegistry.executeAction` を通じて `context.currentAction` をバインドし、効果解決の深部（`dealDamage` コマンドハンドラー内）から、その効果を発生させた元の YAML アクションのキーカード情報やタイミング属性などを完全に逆引き参照できる強固なコンテキスト構造を構築しました。
2. **`AbilityEvaluator` の拡張（常在能力の動的評価）**:
   `AbilityEvaluator` に `shouldPreventDamage(context)` を実装し、ダメージ対象プレイヤーのゲーム状態を透過的にスキャンするロジックを確立しました。
   - **判定ステップ**:
     - 対象プレイヤーの表切札（`trumps` 領域）に表向き（`face: up`）の `trump.fortress` が存在するか。
     - 対象プレイヤーの場（`field`）に `character.` で始まるキャラクター（一般兵など）が1体以上存在するか。
     - ダメージソースが対戦相手からのアクション（`context.playerKey !== targetPlayerKey`）によるものか。
     - アクションのキーカード（`context.keyCards` / `context.keyCard`）の中に `spade` のスートが含まれているか。
3. **`dealDamageHandler` のダメージ軽減・無効化の割り込み**:
   `commandHandlers.ts` の `dealDamage` 処理の開始直前に `abilityEvaluator.shouldPreventDamage(context)` を評価し、真であればライフ減少処理や `cardMoved` イベント発行を即座に早期リターン（スキップ）する形で `damagePrevention` レイヤーを実装しました。これにより、効果処理内に要塞専用の分岐ロジックを直接埋め込む必要がなくなり、極めて高い拡張性を確保しました。

### テストおよび検証結果 (`fortress.test.ts`)
以下のテストケース A〜E を実装し、Vitest によりすべて 100% 期待通りにパスすることを確認しました。
- **ケースA (無効化成功)**: 自分の表切札に要塞があり、自分の場に兵士（キャラクター）がいる状態で、相手が投擲（♠を含む）を実行した際、ダメージが完全に無効化され、自分のライフが減らないこと。
- **ケースB (防衛キャラクター不在による被ダメージ)**: 要塞が表向きであっても、自分の場にキャラクターがいない場合はダメージを防げず、通常通りダメージを受けること。
- **ケースC (要塞裏向き/不在による被ダメージ)**: 要塞が裏向き（`face: down`）または存在しない場合はダメージを防げず、通常通りダメージを受けること。
- **ケースD (スペード非含有による被ダメージ)**: キーカードに♠を含まないアクションによるダメージは、要塞の防衛対象外であるため防がず、通常通りダメージを受けること。
- **ケースE (イベント不発生アサート)**: ダメージが要塞に防がれた場合、ライフから墓地への移動自体がスキップされるため、`cardMoved` イベントが一切発生しないことをディスパッチ関数のスパイにより厳密に検証。

本フェーズの実装により、Vitest 統合テストの全 34 ケースが 100% グリーンでパスし、ビルドも正常終了することを確認しました。新YAML DSLにおける「常在能力」および「状態スキャンを伴う割り込みレイヤー」の実装方式が正しく動作することが実証されました。
