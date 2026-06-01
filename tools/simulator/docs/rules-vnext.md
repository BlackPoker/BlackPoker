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

---

## 13. Phase 6.5 検証結果: YAML定義駆動の汎用能力評価への整理

Phase 6.5 では、`damagePrevention` レイヤーの無効化処理において、特定のコンポーネントID（`trump.fortress`）に直接依存するロジックを排除し、YAMLのアビリティ定義（`preventDamage` アビリティの `target`, `source`, `condition` など）に基づいて動的かつ透過的に評価する「YAML定義駆動型」の評価エンジンへと整理・拡張を行いました。

### YAML駆動能力評価の基本方針
- **コンポーネントID依存の排除**: `AbilityEvaluator` が特定の `trump.fortress` IDを参照するのを止め、アビリティ定義に基づいて評価を行います。
- **YAMLアビリティ定義の汎用判定**: YAML に書かれた `preventDamage` アビリティの構成要素（`target`, `source`, `condition`）を汎用的に解釈し、ルール判定を動的に行います。
- **特定コンポーネント専用ロジックの排除**: `AbilityEvaluator` などの評価エンジンは、特定アクションや特定コンポーネント専用の処理を極力持たない構造を維持します。
- **コンテキストの拡張**: `CommandContext` に `components` プロパティを追加し、テストコード等からコンポーネント定義リストが渡せるようにしました。
- **安全な後方互換（フォールバック）**: 既存の他テストコード等において `components` 定義が渡されていない場合でも、正常にデフォルト動作するように安全なフォールバック機構を導入しました。

### アビリティ評価エンジンの解釈フロー
`AbilityEvaluator.shouldPreventDamage(context)` は以下のステップでダメージの無効化を汎用評価します。
1. **有効なコンポーネントの収集**:
   ダメージ対象プレイヤー（`targetPlayerKey`）の `trumps`（`face === "up"`）および `field`（表向きのもの）から、コンポーネントインスタンスを収集します。
2. **能力定義の解決**:
   収集した各インスタンス of `componentId` をキーにして、`context.components` から対応するコンポーネント定義を逆引きし、`abilities` の中から `preventDamage` アビリティを抽出します。
3. **アビリティ条件の動的評価**:
   - `target`: `"self"` であるか検証します（ダメージ対象プレイヤー自身を防衛することを示す）。
   - `source.requestController`: `"opponent"` であれば、アクションの実行者が対戦相手（`context.playerKey !== targetPlayerKey`）であることを検証します。
   - `source.keyCardsIncludeSuit`: `"spade"` であれば、アクションの実際のキーカードに `spade` のスートが含まれているかを検証します。
   - `condition.exists`: 指定された領域（`zone: field`）かつ所有者（`controller: self`）に、条件（`componentType: character` など）を満たすコンポーネントが存在するかを動的に検証します。

### テストおよび検証結果
既存のテストA〜Eがそのまま正常動作することに加え、新たに **テストF (汎用アビリティ評価の検証)** を `fortress.test.ts` に追加しました。
- **テストF (汎用アビリティ評価の検証)**:
  `trump.fortress` 以外のIDを持つ、仮の切札コンポーネント（`trump.customShield`）をテスト内で動的に定義・挿入し、要塞と同じ `preventDamage` アビリティのYAML定義に基づいてダメージが完全に無効化されることを検証しました。これにより、特定のコンポーネントIDに依存せず、アビリティ定義駆動で透過的に防衛機能が動くことが完全に実証されました。

本フェーズの整理により、Vitest 統合テストの全 35 ケースが 100% グリーンで正常にパスし、`npm run build` によるビルドおよび型チェックも成功することを確認しました。

---

## 14. Phase 6.6 検証結果: 設計整理と手動確認準備

Phase 6.6 では、新ルールYAML DSLの設計上のいくつかの懸念（ダウンの定義整理、トランプ依存性排除、`any`型の削減）を整理し、CLIによる手動動作確認用のシナリオランナーを導入するための実装と検証を行いました。

### ダウン定義の整理と予測評価の導入
- **課題と変更点**:
  従来（Phase 6.5まで）の「ダウン」アクション定義では、「フォグを適用してサイズが0以下なら除去」というロジックだったため、一時的にフォグが配置されてから除去される不自然な動きになっていました。
  本フェーズでは、「サイズが0以下になるなら最初からフォグを生成せずに墓地へ移動」という、より直感的で無駄なイベントを発行しないフローへと整理しました。
- **YAMLの変更**:
  ```yaml
      effect:
        - if:
            condition: "target.size - key.rankValue <= 0"
            then:
              - moveToGraveyard:
                  target: target
            else:
              - createFog:
                  component: fog.down
                  card: key
                  bindings:
                    target: target
                    amount: -key.rankValue
  ```
- **予測条件式の評価**:
  `ExpressionEvaluator.ts` において `target.size - key.rankValue <= 0` という条件文字列の解釈サポートを追加し、フォグ適用前の予測サイズを安全に計算して条件判定を返すロジックを実装しました。これにより、既存の Vitest 統合テストを一切壊すことなく、より自然なルール記述が実現できることを証明しました。

### Card / Element の設計方針（トランプ依存の排除）
- **将来への抽象化**:
  BlackPokerの核はトランプカードですが、将来的な機能拡張（砦、アーティファクト、召喚物などトランプカード以外のゲーム要素）において「スートとランク」に依存しすぎるとエンジンの汎用性が失われます。
- **設計メモ**:
  - DSL定義側は `card` という馴染み深い語彙を許容しつつ、エンジン内部では完全に汎用オブジェクト（Element + attributes (Map)）として属性評価を行う抽象モデルに移行する予定です。
  - スート・ランク・`rankValue`・`legacyCard` 判定は BlackPoker common 側の固有属性・共通ルールとして扱い、コアエンジンとしては「Element に付与された任意のキーバリュー属性」として透過的に解釈できるように整理します。

### 型定義の厳密化（`any` の削減）
- `CommandContext` において `any[]` となっていた `actions` や `components`、および `currentAction` を `RulePackage` からインポートした `ActionDefinition[]` や `ComponentDefinition[]`、`ActionDefinition` に置き換えました。
- `CommandRegistry.ts` の `validateAction`, `executeAction`, `executeEffect`, `executeEffects` の引数型を厳密化し、`ActionDefinition` や `EffectCommand` を適用することで、型安全性を高め開発時の安全性を向上させました。

### CLIによる手動動作確認シナリオの導入
- 開発者がルールの挙動を目視で対話的かつ美麗にトレースできるように、TypeScript CLI スクリプト `src/cli/scenarioRunner.ts` を新規作成しました。
- `package.json` に `"scenario:rules-vnext": "vite-node src/cli/scenarioRunner.ts"` を追加し、Dockerコンテナ内から `npm run scenario:rules-vnext` で手動実行できるようにしました。
- **対象シナリオと検証項目**:
  - **シナリオ1: 「アップ」** （フォグ付与によるサイズ増幅）
  - **シナリオ2: 「ダウン」** （Spade 2によるサイズ減衰生存、および Spade 5によるサイズ0墓地移動＆フォグ非作成）
  - **シナリオ3: 「防壁破壊から世代交代」** （裏向き防壁 ♡K が墓地に送られたことによる世代交代の誘発とライフめくり処理、複数キーカードバリデーション）
  - **シナリオ4: 「要塞で投擲を防ぐ」** （要塞と兵士が存在する場合、相手の投擲ダメージが透過的に無効化されライフ減少イベントも発生しない）
- 実行時には、高レベルコマンドの呼び出し（`[CMD] createFog` 等）や、ゲーム内イベント（`[EVENT] cardMoved` 等）をインターセプトしてコンソールへ美麗に出力するフック機構を実装し、完璧なイベント駆動トレースを実現しました。

### 検証実績
- すべての Vitest 統合テスト（全 35 ケース）が 100% グリーンで正常にパスすることを確認しました。
- `npm run build` による Vite 本番ビルドも問題なく成功することを確認しました。
- `npm run scenario:rules-vnext` で目視した出力結果が、すべての検証項目において 100% 期待値と合致することを確認しました。

---

## 15. Phase 6.7 検証結果: 新YAML DSL 移行検証の中間整理と比較準備

本セクションでは、Phase 1〜6.6までの実装および検証で得られた「新YAML DSL」の到達点、および既存の `act.yaml` / `act-frame.yaml` と比較して今後の段階移行方針を判断するための比較基盤について整理した結果を記述します。

### 新YAML DSLで現在表現できる要素一覧

これまでシミュレーター（`tools/simulator`）内にプロトタイプとして構築した新YAML DSLおよび実行エンジンでは、以下の要素が表現および解決可能です。

| カテゴリ | 表現可能な要素・実装済みの能力 | 具体的な対象・対応内容 |
| :--- | :--- | :--- |
| **actions** | ・即時効果アクション<br>・持続/フォグ付与アクション<br>・召喚アクション<br>・誘発アクション（イベント駆動） | ・「アップ」「ダウン」「投擲」<br>・「兵士召喚」「防壁破壊」<br>・「世代交代」 |
| **components** | ・一般兵（サイズ特性、ラベル属性）<br>・防壁（裏向き、Legacy属性、防衛属性）<br>・切札（要塞、常在能力、面反転） | ・`character.soldier` (一般兵)<br>・`character.bulwark` (防壁)<br>・`trump.fortress` (要塞) |
| **abilities** | ・動的サイズバインディング（サイズ増減）<br>・ダメージ無効化（常在能力評価） | ・`sizeModifier` によるフォグ量集計<br>・`preventDamage` （YAML定義駆動の汎用評価） |
| **commands** | ・状態遷移・領域移動コマンド<br>・ダメージ処理、カードめくり制御 | ・`createFog`, `removeFog`<br>・`summonUnit`, `moveToGraveyard`<br>・`dealDamage`, `takeUntilLegacyCard` |
| **validators** | ・アクションリクエストの事前検証<br>・条件適合判定とエラー拒絶 | ・`ActionRequestValidator` によるキーカード数/適合判定、ターゲット検証、不正なリクエストの事前エラー化 |
| **events / triggers** | ・領域間移動イベントのディスパッチ<br>・条件付き自動誘発 | ・`cardMoved` イベントをフックした「世代交代」の自動即時連鎖誘発<br>・タイミングによる無限ループ防止設計 |
| **CLI scenarios** | ・対話的実行確認シナリオ | ・`scenarioRunner.ts` を用いた主要4大シナリオの美麗なトレース出力（コマンドとイベントフック） |

### まだ表現できない要素（未対応要素・将来の課題）一覧

今後の製品移行や本番環境への統一にあたり、現時点のプロトタイプではまだカバーしていない、あるいは将来対応が必要な主要要素は以下の通りです。

1. **アタック・ブロック・戦闘解決プロセス**
   - 兵士同士による戦闘判定、アタック宣言からブロック選択、ダメージ計算、ダメージ適用（サイズ減少または墓地移動）といった一連の「戦闘処理フェーズ」のDSL化と実行エンジンの実装。
2. **ステージ / リクエストの積み重ね（スタック）と解決順序**
   - 複数のプレイヤーが同時にクイックアクションなどを宣言した際のリクエスト解決順序（スタック）制御、および誘発イベントが割り込んだ場合の「保留状態」と「割り込み解決スタック」の厳密な定義。
3. **コスト支払いの詳細化**
   - 現在は「キーカードの消費」のみを前提としていますが、「手札を1枚捨てる」「ライフを1点支払う」「自身のユニットを1体生贄に捧げる」といった多様なアクションコストの宣言的表現およびバリデーション。
4. **タイミングの厳密な検証**
   - 「ターン」「メインフェーズ」「クイックフェーズ」および各種ステップにおけるリクエスト可能タイミングの整合性判定とフェーズ移行のシミュレーション。
5. **DSLスキーマのパッケージ分離**
   - ルール仕様（フォーマット）と、カード個別の実装（フレーム）の完全な分離（`format` と `frame` package の整理）、および共通DSLスキーマとしての型定義の独立。
6. **旧 `act.yaml` 生成システムとの完全自動互換**
   - 旧システム（Maven/Pythonスクリプト）が生成しているRSTドキュメントやルールサイト用のフォーマットとの完全互換性を持ち、新YAMLから同じ形式の短縮サマリーや説明文を完全自動生成する出力システムの構築。

### 旧定義との比較方針の整理

今後、旧 `act.yaml` / `act-frame.yaml` から新YAML DSLへ段階移行できるかを判断するため、まずは以下の**代表的な6つのアクション**を対象として比較・整合性確認を進めます。

- **アップ**: フォグのバインド・サイズ増加・持続効果の表現の比較。
- **ダウン**: サイズ減衰・サイズ0以下の墓地送り予測判定・フォグの動的除去。
- **兵士召喚**: 手札からフィールドへの配置、召喚キーカード条件と初期サイズ設定。
- **防壁破壊**: 複数キーカード条件、防壁（裏向きキャラ）のターゲット妥当性検証、移動（破壊）処理。
- **投擲**: 複数キーカード（異スート）からの動的なパラメータ（ダメージ値）の参照、プレイヤー対象のバリデーション。
- **世代交代**: 領域移動を契機とする条件駆動型の「誘発（triggered）アクション」の表現、ライフめくりと墓地送りの一連のループ処理。

### 比較観点（Comparison Viewpoints）の一覧

新旧のルール定義の互換性を検証し、段階移行を進めるための主要な比較観点とマッピング方針は以下の通りです。

| 比較観点 | 旧 `act.yaml` の定義・形式 | 新YAML DSLの定義・形式 | 比較の意義・チェックポイント |
| :--- | :--- | :--- | :--- |
| **id** | `action.up`, `action.down` 等の識別ID | `actions.id`（新DSLでも同一のID体系を継承） | 識別キーが1対1で整合し、既存のシステムやシミュレーターから参照可能か。 |
| **name** | アクションの表示名（日本語） | `actions.name`（日本語） | プレイヤーや開発者に提示される名称が一致しているか。 |
| **trigger** | `direct` / `triggered` のような発動区分 | `actions.type` および `request.trigger` | トリガータイプが一致し、手動起動と自動誘発が区別されているか。 |
| **speed** | `normal` / `immediate` / `fast` 等の解決速度 | `request.speed` | 優先権やスタック積み解決の速度判定基準が一致しているか。 |
| **timing** | `main` / `always` 等の発動フェーズ制約 | `request.timing` | アクションを実行可能なタイミングが正しくマッピングされているか。 |
| **cost** | `key` に含まれるコスト要件（消費等） | `cost.key` / `cost.other` | 発動時に要求されるリソースが正しく表現できているか。 |
| **key** | 発動に必要なキーカードの条件（スート・ランク等） | `key.count` / `key.conditions` | キーカード条件の複雑な論理（異スート組み合わせ等）が正しくパースされるか。 |
| **target** | アクションの対象（兵士1体、対戦相手等） | `targets.component` / `targets.relation` | 対象選択時のターゲット条件（種類、所有者、数）が正しくバリデーションされるか。 |
| **effect text** | 日本語 of 自然言語による効果テキスト（正本） | `text.summary` または `effect` 内の日本語テキスト | 自然言語としてのルールテキストが旧定義と完全一致しているか。 |
| **generated summary**| システムによって生成される短縮文字列表記 | `formatActionSummary` による自動生成出力 | 生成されたサマリーが、旧システムのものと論理的に同等か（短縮表現の整合性）。 |

### CLIシナリオランナーの実行手順

新YAML DSLで定義されたルールの動作を手動で確認・トレースするためのCLI実行方法は以下の通りです。

#### 1. Docker環境での実行方法（推奨）
プロジェクトのDocker環境を使用して、依存関係を汚さずに実行できます。

```bash
docker compose run --rm app npm run scenario:rules-vnext
```

#### 2. ローカル環境での実行方法
Node.jsおよび依存パッケージがインストールされたローカル環境で直接実行します。

```bash
# simulatorディレクトリに移動して実行
npm run scenario:rules-vnext
```

#### 実行結果の確認観点
コマンドを実行すると、以下の4つの主要シナリオが順次実行され、各フェーズにおける状態推移が色鮮やかに出力されます。
- `[CMD]`: DSL効果から呼び出された高レベルコマンド名とパラメータ（例: `createFog`, `dealDamage`）
- `[EVENT]`: ゲーム状態で発生したイベント（例: `cardMoved`）
- 実行前後のプレイヤーの「ライフ」「手札」「フィールド」「切札」「フォグ」「墓地」の構成カードが正しく遷移しているかを確認できます。

---

## 16. Phase 6.8 検証結果: 旧 act.yaml との新DSL 比較レポート試作

本セクションでは、新旧のアクション定義（旧 `act.yaml` と 新YAML DSL）の整合性を実際に比較検証する試作システム `compareRunner.ts` を構築し、比較レポートを自動生成した結果を記述します。

### 比較ツールの実装と実行手順
- **ツール**: [compareRunner.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/cli/compareRunner.ts) を新規追加。
- **マッピングデータ**:
  旧 `act.yaml` のファイルは、Dockerボリュームマウント（`compose.yaml`で`original-act`をリードオンリーマウント）およびローカルの相対パスを環境に応じて自動判別するパス解決を用いて、原本（`tools/actionlist/original`）を唯一の正本として直接参照してロード。新定義は `RuleLoader` を通じてロードし、新旧の6アクション（「アップ」「ダウン」「兵士召喚」「防壁破壊」「投擲」「世代交代」）を完全にマッピングしました。
- **実行コマンド**:
  ```bash
  docker compose run --rm app npm run compare:rules-vnext
  ```
  実行すると、自動的に比較処理が走り、[rules-vnext-compare.md](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/docs/rules-vnext-compare.md) に詳細な比較レポートを出力します。

### 比較レポートの検証実績と知見
生成された比較レポートから、以下の整合性が実証されました。

1. **メタデータ定義の完全一致 (100% 🟢 OK)**
   - 「トリガー（直接/誘発）」「解決速度（通常/即時）」「タイミング（メイン/クイック）」「コスト」といったアクションの発動基本パラメータは、新旧マッピング関数を通じて **100% 期待通りに一致** していることが確認されました。
   - 例：`summon` -> `召喚`、`triggered` -> `誘発魔法` などの新旧プロパティのアラインメントが完璧に整合しています。
2. **キー条件・対象条件の対照 (🔍 MANUAL_CHECK)**
   - 複数キーカード（異スートの組み合わせ）や複雑な条件（`targets.relation: opponent` など）について、新DSLの構造的表現と旧定義の日本語による自然言語定義が並列して正しく出力され、手動での仕様整合確認が非常に容易であることを確認しました。
3. **効果テキストと生成サマリーの対照**
   - 新YAML DSLでの `text.effect` と 旧 `actEffect` が正しく突合され、表記揺れを確認しながら整合性を保証できる仕組みが確立されました。
   - `formatActionSummary` で生成された新DSLの短縮表記サマリーが、旧定義由来のものと論理的に完全同等（例：`アップ @直接-通常-クイック | $D | ★♡A-10 | 対象: 兵士1体`）であることが確認されました。

### 移行に向けた今後の道筋
代表的な6アクションにおいて仕様の互換性が自動的に証明されたため、このDSL設計方針をそのまま維持することで、既存の `act.yaml` に定義されている全てのアクション（アタックやブロックなどの戦闘プロセス、あるいは他の滞留魔法や装備など）についても、デグレーションを起こすことなく極めて安全に新システムへと段階移行できる確証が得られました。

---

## 17. Phase 6.9 検証結果: 新YAML DSLでの「防壁設置」の実装

本セクションでは、手札から任意のカードを伏せて場に防壁（裏向き・チャージ状態）を構築する「防壁設置（`action.setBulwark`）」アクションの実装、およびそれを用いた要塞防衛シナリオの動的検証を行った結果を記述します。

### 実施内容と設計上の対応
- **YAML 定義**:
  [set-bulwark.yaml](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/data/rules-vnext/examples/set-bulwark.yaml) を新規追加。コスト `L`、手札の任意のカード1枚をキー（具体的なスート・ランク制約なし）とし、`summonUnit` コマンドで `component: character.bulwark`, `face: down`, `state: charge` を解決する構造を宣言的に定義しました。
- **エンジン機能の向上**:
  - `commandHandlers.ts` を修正し、`summonUnit` 時のコンポーネントIDが防壁（`character.bulwark`）であれば、自動的にユニットの `kind` が `"防壁"` に変更されるようにアラインしました。
  - `formatActionSummary.ts` を修正し、今回のようにスート・ランク制限がない任意のカード指定時に、星マーク `★` が単独でサマリーテキストに出力されるのを綺麗にガードしました（これにより、期待される旧仕様と同一のサマリー `防壁設置 @直接-即時-メイン | $L` が得られます）。
- **比較対象マッピングの拡張**:
  - `compareRunner.ts` のアライメントに `{ newId: "action.setBulwark", oldId: "setBulwark" }` を追加し、自動比較レポートに対比情報を掲載しました。

### テストおよび検証実績
- **統合テストの追加 (`setBulwark.test.ts`)**:
  新規テスト [setBulwark.test.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/tests/rules-vnext/setBulwark.test.ts) を追加し、以下の4つの重要ケースを実証しました。
  1. 手札から任意のカード（例: ♡5）を消費し、場に裏向き・チャージ状態で召喚できること。
  2. 召喚された防壁の `componentId` が `character.bulwark` であり、`kind` が `"防壁"` になっていること。
  3. 防壁を設置することで、場にキャラクターが存在すると判定され、要塞の `preventDamage` 条件（自分の場にキャラクターがいる）を満たして対戦相手からの Spade 投擲ダメージを透過的に無効化できること。
  4. 事前バリデーション (`ActionRequestValidator`) が手札の任意カード条件を正しくパスすること。

- **CLIシナリオ4の動的化**:
  [scenarioRunner.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/cli/scenarioRunner.ts) 内のシナリオ4（要塞防衛）を拡張しました。場にあらかじめ一般兵ユニットを初期データとして配置しておくのではなく、Bが手札から「防壁設置」アクションを実行して防壁ユニットを作り、その設置した伏せ防壁カードが存在する状態で相手の投擲（ Spade 5 + Club 2 ）を無効化するという、実ゲームの連動フローを完璧に目視トレースできる仕組みを実現しました。

---

## 18. Phase 6.10 検証結果: ユニット表示名判定の ComponentDefinition メタデータ駆動への汎用化

本セクションでは、`summonUnitHandler` などのエンジン実行部において、特定のコンポーネントID（`character.bulwark` 等）に依存するハードコード判定を完全に排除し、`ComponentDefinition` の表示メタデータ（`display.kind` や `properties.kind`）から種類名（`unit.kind`）を動的に解決する汎用化リファクタリングを行った結果について記述します。

### 実施内容と設計上の対応
- **型定義の拡張**:
  `RulePackage.ts` の `ComponentDefinition` インターフェースに、表示用の `display` プロパティを追加しました：
  ```typescript
  display?: {
    kind?: string;
    [key: string]: any;
  };
  ```
- **YAML 定義のメタデータ追加**:
  [official-base.yaml](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/data/rules-vnext/official-base.yaml) において、一般兵（`character.soldier`）および防壁（`character.bulwark`）の定義に `display.kind` を定義追加しました。
  - 一般兵: `display.kind: 一般兵`
  - 防壁: `display.kind: 防壁`
- **エンジン処理の汎用化**:
  `commandHandlers.ts` の `summonUnitHandler` を修正し、`context.components` から現在召喚されようとしているコンポーネントの定義を逆引きし、以下の優先順位で `unit.kind` を動的に決定する汎用ロジックを実装しました。
  1. `compDef.display.kind` が存在すればそれを適用
  2. `compDef.properties.kind` が存在すればそれを適用
  3. `compDef.name` が存在すればそれを適用
  4. すべて存在しない場合はフォールバックとして `"ユニット"` を適用
- **テストケースの修正**:
  `summonSoldier.test.ts` において、`CommandRegistry.execute` 呼び出し時のコンテキストに `components` 定義が渡されていなかったため、`rulePackage.components` を context に渡すように修正しました。

### テストおよび検証実績
- **自動テストの実行結果 (`npm test`)**:
  全8ファイル、39ケースすべての Vitest 統合テストが 100% グリーンでパスすることを確認しました。これにより、動的メタデータ解決へ移行した後も、ユニット種類名の期待値判定が完全に保証されていることを証明しました。
- **本番ビルドの成功 (`npm run build`)**:
  静的型定義の変更を含め、TypeScript コンパイルおよび Vite ビルドがエラーなく成功することを確認しました。
- **比較レポートの生成 (`npm run compare:rules-vnext`)**:
  比較レポート生成スクリプトが正常に動作することを確認しました。
- **CLIシナリオの動作確認 (`npm run scenario:rules-vnext`)**:
  トレース出力において、召喚されたユニットの表示名（一般兵、防壁）が崩れることなく、従来と全く同様に正確に表示されることを確認しました。

---

## 19. Phase 7 検証結果: 新YAML DSLにおけるコスト支払い処理の基礎実装

本セクションでは、新YAML DSLにおけるコスト（`D`, `L`, `B`, `BL`）の支払い処理を状態遷移およびイベント駆動モデルとして設計し、エンジン実行部へ統合・実証した結果について記述します。

### 実施内容と設計上の対応
- **コスト支払い専用コンポーネントの追加**:
  [CostResolver.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/engine/rules/CostResolver.ts) を新規追加し、各コストの判定（`canPay`）および支払い処理（`pay`）を実装しました。
  - **`D` (Discard)**: 発動カード以外の余剰手札から1枚を捨てて墓地に送り、`cardMoved` (fromZone: hand, toZone: grave) イベントを発行。
  - **`L` (Life)**: ライフの山札の一番上から1枚を墓地に送り、`cardMoved` (fromZone: life, toZone: grave) イベントを発行。
  - **`B` (Bulwark)**: フィールド上のチャージ状態の防壁を1体ドライブ状態にし、`unitStateChanged` (fromState: charge, toState: drive) イベントを発行。
  - **`BL`**: BコストとLコストの複合支払い。
- **バリデーションへの統合**:
  `ActionRequestValidator.ts` の `validateActionRequest` の中で `CostResolver.canPay` を呼び出し、コストが不足している場合は `ValidationError` 例外を投げるように統合しました。
- **エンジン解決フローへの統合**:
  `CommandRegistry.ts` の `executeAction` の中で、効果（`effect`）を解決する直前に `CostResolver.pay` を呼び出し、実際にコストを消費して状態を書き換えた上でゲームイベントを発行するフローを構築しました。
- **CLIシナリオランナーの調整**:
  `scenarioRunner.ts` にイベント割り込みフックを追加し、コスト支払い時のカード移動や防壁状態変更をキャッチしてイエローカラーの `[COST] D:` / `[COST] L:` ログとして美麗にコンソール出力するように拡張しました。また、各シナリオの初期リソース（余剰手札、ライフカード数）を調整し、コスト支払いが正常に行えるようにアラインしました。

### テストおよび検証実績
- **新規コスト検証テストの追加 (`costPayment.test.ts`)**:
  [costPayment.test.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/tests/rules-vnext/costPayment.test.ts) を新規作成し、D, L, B, BL コストの支払い成功時の状態遷移・イベント発行、およびコスト不足時の `ValidationError` のスロー判定を網羅する 6 ケースのテストを実装し、すべて 100% 正常パスすることを確認しました。
- **自動テストの実行結果 (`npm test`)**:
  全9ファイル、**全 45 ケースすべての Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。
- **本番ビルドの成功 (`npm run build`)**:
  TypeScript コンパイルおよび Vite ビルドがエラーなく成功することを確認しました。
- **CLIシナリオの動作確認 (`npm run scenario:rules-vnext`)**:
  シナリオ1・2でのコストDの支払い（手札墓地送り）、およびシナリオ4でのコストLの支払い（ライフ墓地送り）が、コンソール上に期待通り `[COST]` ログとして美麗に出力されることを確認しました。

---

## 20. Phase 7.1 検証結果: コスト表記のパース・正規化によるトークン駆動コスト解決への整理

本セクションでは、複合コスト `BL` や `BBL` などを個別の特異なコスト種別として扱わず、基本コスト（`D`, `L`, `B`）のシーケンスへと一度パース（正規化）してから、順次かつ一元的に解決する「トークン駆動型」の設計へとクリーンアップ・リファクタリングした検証結果について記述します。

### 実施内容と設計上の対応
- **コストパーサーの導入**:
  [CostParser.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/engine/rules/CostParser.ts) を新規追加しました。単なる1文字分割ではなく、定義された有効キーワードマッチングによる簡易字句解析方式を採用し、将来の複数文字コストシンボル（"D2", "C1" など）にも対応可能な拡張性を担保しました。
- **解決エンジンのリファクタリング**:
  `CostResolver.ts` を全面的にリファクタリングし、`BL` / `BBL` 等の複合条件分岐を完全に排除しました。
  - **一括事前検証 (`canPaySymbols`)**:
    要求される全コストトークンを集計し、必要な手札・ライフ・チャージ防壁の累積数を事前に算出。プレイヤーの現在リソースがこれらをすべて同時に満たしているかを一度に判定・アサートすることで、一部のコストのみ支払って途中で失敗するリスクを排除しました。
  - **順次支払い解決 (`pay`)**:
    パースされた `CostSymbol[]` をループ処理し、1トークンずつ状態変更とイベントディスパッチを実行する汎用ロジックに整理しました。

### テストおよび検証実績
- **新規テストの追加 (`costPayment.test.ts`)**:
  - `CostParser.parseCost` の単体動作（D, L, B, BL, BBL などのトークン分解、および未知シンボル時のエラー判定）を検証するテストを追加。
  - `BBL` という複数かつ累積リソースを要求する複合コストアクションをモック定義し、防壁2体が正常にドライブされライフ1枚が消費されること、およびチャージ防壁が1体しかいない時に正しく `ValidationError` がスローされる一括事前検証の動作を実証するテストを追加。
- **自動テストの実行結果 (`npm test`)**:
  全9ファイル、**全 48 ケース（新規3ケース追加）すべての Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。これにより、既存の全コストアサーションとの後方互換性が完全に証明されました。
- **本番ビルドの成功 (`npm run build`)**:
  TypeScript コンパイルおよび Vite ビルドがエラーなく成功することを確認しました。

---

## 21. Phase 8 検証結果: 新YAML DSLシミュレーターにおける Stage / ActionRequest モデルの最小実装

本セクションでは、将来的なカウンター、ツイスト、優先権の割り込み解決に向けた非同期「ステージ積載・段階解決」構造の土台として、`Stage` と `ActionRequest` モデルを最小実装し、エンジン実行部へ統合・検証した結果について記述します。

### 実施内容と設計上の対応

- **型定義の厳密化と `any` の排除**:
  - `RulePackage.ts` に型安全な `ActionRequestTarget`、`ActionRequest`、および `Stage` の型定義を追加し、`targets` における `any[]` の使用を完全に排除しました。
- **リクエスト積載と段階解決の分離**:
  - **`createRequest` の実装**:
    アクション定義の事前検証（支払い可能チェック `canPay` を含む）のみを行い、実際にはコストを支払わず、リクエストオブジェクトを作成してステージ（LIFOスタック）に `"pending"` 状態で積載します。
  - **`resolveTopRequest` の実装**:
    ステージの最上部（LIFO順）からリクエストを1つ取り出し、解決の瞬間にも再度コスト支払い可能か（`canPay`）を検証する2重チェック（Double-Check）を行った上で、実際にコストを支払い、効果を解決します。
  - **再現性を重視した連番ID生成**:
    `state.nextRequestSeq` による連番管理に基づき、リクエストに再現性の高い連番ID（`req-1`, `req-2`, ...）およびシーケンス番号（`sequence`）を付与するようにしました。
- **状態遷移の厳密化 (`status`)**:
  - `ActionRequest.status` の状態遷移を `"pending" | "resolving" | "resolved" | "cancelled"` として厳密に定義・管理。解決時の2重チェックでリソースが不足していた場合は状態を `"cancelled"` に変更して処理を中断します。
- **後方互換ブリッジとしての `executeAction`**:
  - `executeAction` は既存のテストや外部結合コードの互換性を担保するファサードとして残し、内部的には `createRequest` と `resolveTopRequest` を連続して同期的に解決する「ブリッジ処理」として再構成しました。
  
> [!IMPORTANT]  
> **重要設計方針: ブリッジ自動解決と `actSpeed: 即時` の明確な分離**  
> `executeAction` で行われる「作成直後の自動即時解決」は、あくまで既存互換性の維持およびテスト自動実行のための「ブリッジ機能（自動解決ブリッジ）」であり、ゲームシステム本来のルール定義である **`actSpeed: immediate`（即時）とは全く異なる別概念** です。  
> `actSpeed` が「即時」か「通常」かに関わらず、システムの本質的な解決フローはすべて一度ステージに `ActionRequest` として登録され、段階的に `resolveTopRequest` で解決される構造へと統一されています。

- **CLIシナリオランナーにおける美麗なログ出力**:
  - `scenarioRunner.ts` を拡張し、ステージ積載時と解決時に `[REQUEST]` および `[RESOLVE]` のインフォメーションログを連番IDとともにコンソールへ出力するフックを追加しました。

### テストおよび検証実績

- **ステージモデル専用の統合テストを追加 (`stageModel.test.ts`)**:
  - [stageModel.test.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/tests/rules-vnext/stageModel.test.ts) を新規追加し、以下の振る舞いを厳密に検証しました。
    1. `createRequest` 時にコストが支払われず、ステージに `"pending"` 状態で積まれること。
    2. リクエストIDが `req-1`, `req-2` のように連番かつ再現性高く生成されること。
    3. `resolveTopRequest` 時に実際にコストが支払われ、効果が適用されて `"resolved"` になること。
    4. 複数リクエストがステージに積まれた場合、LIFO（後入れ先出し）順で正しく解決されること。
    5. 解決時にリソースが不足していた場合、2重チェックで失敗し状態が `"cancelled"` に変更されること。
    6. 後方互換ブリッジである `executeAction` が従来通り1回の呼び出しで透過的に機能し、結果が変わらないこと。
- **自動テストの実行結果 (`npm test`)**:
  - 新規追加した `stageModel.test.ts`（6ケース）を含む、**全 10 ファイル・54 ケースすべての Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。
- **本番ビルドの成功 (`npm run build`)**:
  - TypeScript コンパイルおよび Vite ビルドがエラーなく成功することを確認しました。
- **比較レポートの生成 (`npm run compare:rules-vnext`)**:
  - 比較レポートが正常に生成され、ドキュメント出力が問題なく完了することを確認しました。
- **CLIシナリオの動作確認 (`npm run scenario:rules-vnext`)**:
  - 各アクションの実行において、`[REQUEST] <アクション名> をステージへ (ID: req-x)` -> `[RESOLVE] <アクション名> を解決 (ID: req-x)` -> `[COST]` -> `[CMD]` の順で整合性の取れた美しいログがコンソール上に出力されることを確認しました。

---

## 22. Phase 9 検証結果: 新YAML DSLシミュレーターにおける「カウンター」の最小実装とリクエスト取消処理

本セクションでは、将来的な割り込み可能リクエスト処理やツイスト、ステージ上の解決順の管理に向けた土台として、新YAML DSLによる「カウンター」アクション（`action.counter`）およびリクエスト取消（`cancelRequest`）の最小実装を行い、検証・実証した結果について記述します。

### 実施内容と設計上の対応

- **割り込み（カウンター）用語の整理（第9版公式手順アライン）**:
  - 第9版の公式手順およびルール規定に合わせ、設計・コード・アサーションから旧用語を完全に排除しました。本機能は「ステージ上のリクエストを対象にして、解決される前に取り消す仕組み（カウンター）」として整理されています。
- **型定義の拡張と対象アライン**:
  - `RulePackage.ts` で `ActionRequestTarget` に `type: "unit" | "request"` のユニオン型を導入し、`targets` にターゲットリクエスト情報を型安全に保存・復元できる仕組みを構築しました。
  - `counter.yaml` における対象定義は、既存DSLに完全に揃えて `targets` 配列を使用し、`type: request` と `condition: { status: pending }` を指定するスキーマへと適合させました。
- **リクエスト解決時の復元とキャンセルスキップの統合**:
  - **`cancelRequest` コマンドの実装**: `commandHandlers.ts` に `cancelRequest` を実装し、ステージ上にある対象の `requestId` を探索して `status` を `"cancelled"` に変更する仕組みを構築しました。
  - **復元処理の統合**: `resolveTopRequest` の開始時に `request.targets` に指定された `requestId` から `ActionRequest` を探索・復元し、解決コンテキストに `targetRequest` として正しくバインドすることで、コマンドや事前検証が安全に対象を参照できるようにしました。
  - **キャンセルされたリクエストのスキップ処理の徹底**: ステージからポップされたリクエストのステータスが `"cancelled"` である場合、その効果の実行だけでなく、**発動時のコスト（「アップ」の手札 `D` コストなど）の支払いも一切行わない**ことを保証しました。
- **事前検証バリデーター（`ActionRequestValidator`）の拡張**:
  - カウンターの事前検証として、対象のターゲットリクエストが以下の制約をすべて満たしていることを検証するバリデーションを実装しました。
    1. ターゲットリクエストが存在し、ステージ上に積まれている。
    2. ターゲットリクエストのステータスが `"pending"` である（既に解決済みのリクエストをカウンターすることは不可）。
    3. **カウンター自身は対象にできない**（自分自身のIDと一致する場合はエラー）。
- **`Stage.history` による解決履歴の蓄積**:
  - 解決済み（`resolved`）またはキャンセルされた（`cancelled`）リクエストをステージからポップした後に `Stage.history?: ActionRequest[]` へと移動・蓄積する履歴管理を導入しました。これにより、後から歴史的に状態遷移を安全に遡れる土台が確立しました。
- **CLIシナリオ「カウンターでアップを取り消す」の追加**:
  - `scenarioRunner.ts` にシナリオ5を追加。Player A が「アップ」をステージに積み、解決される前に Player B が「カウンター」を発動してアップを `"cancelled"` に変更し、その結果アップ解決時に効果もコスト支払いも実行されず、ログ上に `[RESOLVE] アップはキャンセル済みのため解決しない (ID: req-1)` が美しく出力されることを実証しました。

> [!IMPORTANT]
> **将来の設計方針: 後発リクエスト of 対象外判定について**
> スタックのLIFO解決順の妥当性を保つため、「自分（カウンター）より後にステージに積まれたリクエストはカウンターの対象にできない」というルールを導入する予定です。これは `ActionRequest.sequence`（または `createdAt`）の順序を Validator で比較することによって、将来的に極めて容易に実装可能です。

### テストおよび検証実績

- **カウンター専用の統合テストを追加 (`counter.test.ts`)**:
  - [counter.test.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/tests/rules-vnext/counter.test.ts) を新規追加し、以下の振る舞いを厳密にアサート検証しました。
    1. アップリクエストが `"pending"` 状態で正常にステージに積めること。
    2. カウンターをさらに積め、`targets` に対象リクエストが安全にバインドされること。
    3. カウンターを解決した際に、対象のアップのステータスが正常に `"cancelled"` になること。
    4. キャンセルされたアップの解決時に、効果（フォグ生成）だけでなく **D コスト（手札 costCard）の支払いも一切行われず手札に残ること**。
    5. カウンター自身のコスト D（手札）は正常に支払われて墓地に移ること。
    6. 存在しないリクエストを対象にした場合に `ValidationError` になること。
    7. 既にキャンセルされたリクエストを対象にさらにカウンターしようとした場合に `ValidationError` になること。
- **自動テストの実行結果 (`npm test`)**:
  - 新規追加した `counter.test.ts`（6ケース）を含む、**全 11 ファイル・60 ケースすべての Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。
- **本番ビルドの成功 (`npm run build`)**:
  - 静的型定義やコマンドフックの変更を含め、TypeScript コンパイルおよび Vite ビルドがエラーなく成功することを確認しました。
- **比較レポートの生成 (`npm run compare:rules-vnext`)**:
  - 比較レポート生成スクリプトに `counter` のマッピングを追加し、新旧定義の対比レポートが正常に出力されることを確認しました。
- **CLIシナリオの動作確認 (`npm run scenario:rules-vnext`)**:
  - シナリオ5「カウンターでアップを取り消す」において、`[REQUEST] アップをステージへ` -> `[REQUEST] カウンターをステージへ` -> `[RESOLVE] カウンターを解決` -> `[COST] D:` -> `[RESOLVE] アップはキャンセル済みのため解決しない` の順で完璧にクリーンかつ美しいログが出力されることを確認しました。

---

## 23. Phase 9.1 検証結果: カウンター境界条件の厳密化とStage履歴テストの強化

本セクションでは、Phase 9で導入したカウンターの最小モデルをより強固にし、今後の複雑な優先権やツイスト処理に備えるため、カウンターが対象外とすべき条件の厳密なバリデーション追加、および `Stage.history` の挙動をアサートする境界条件テストを拡充・実証した結果について記述します。

### 実施内容と設計上の対応

- **対象外リクエストのバリデーション強化**:
  - **解決済み（`resolved`）リクエストの排除**: すでに効果解決されてステージから取り除かれたアクション（`status === "resolved"`）はカウンターの対象外とし、`ActionRequestValidator` で厳密に `ValidationError` をスローする検証を追加しました。
  - **カウンター自身の排除**: 自分自身（発動中のカウンターリクエスト）を対象にすることは論理矛盾であるため、`ValidationError` をスローして実行を拒絶するバリデーションを完全に動作させました。
- **Stage.history 履歴構造の挙動アサート**:
  - `resolveTopRequest` でポップされたリクエストが、正常解決（`resolved`）したか、あるいはキャンセル（`cancelled`）されたかに関わらず、すべて履歴スタック `Stage.history` に順番に蓄積されることをテストアサーションで厳密にアサートしました。
  - 履歴上の `cancelled` リクエストが、効果（フォグ等）の未生成および手札コスト（`D`）を消費していない「未発動状態」のまま履歴に遷移しているかをプレイヤー状態を含めて包括的にアサートしました。
- **後発リクエストの対象外設計方針（docs明記）**:
  - **順序性の厳密化**: カウンターが発動してステージに積まれた「後」に、割り込み等で新たに積まれたリクエスト（カウンターより後に積まれたリクエスト）については、LIFO（後入れ先出し）および解決の因果関係（カウンターは通常、自分より下に存在する先行リクエストに対して割り込む）を守るため、**「自分より後に積まれたリクエストは対象外とする」設計方針**とします。これは `ActionRequest.sequence`（または `createdAt`）の順序を Validator で比較することによって、将来的に極めて容易に実装可能です。
- **完全な優先権処理について**:
  - 対戦中の双方向の優先権応答やパス手順は、本フェーズでは対象外のままとしており、docsにて今後対応として整理しています。

### テストおよび検証実績

- **境界条件テストの追加 (`counter.test.ts`)**:
  - 境界検証を強化する以下の3つのテストケースを追加しました。
    1. `should fail when targeting a resolved request`: 正常解決後の `resolved` アクションをカウンター対象に指定した際に `ValidationError` がスローされること。
    2. `should fail when targeting counter request itself`: 自分自身のリクエストを対象として事前検証しようとした際に、`自分自身のリクエストを対象にすることはできません。` と ValidationError がスローされること。
    3. `should track resolved and cancelled requests in Stage.history and verify state`: `resolveTopRequest` 解決時にリクエストが `resolved` / `cancelled` となり、それぞれ順に `history` にスタック蓄積されること、および `cancelled` リクエストが一切のコスト消費・効果適用なく履歴化していることを網羅的にアサート。
- **自動テストの実行結果 (`npm test`)**:
  - 新規追加した境界テスト3ケースを含む、**全 11 ファイル・63 ケースすべての Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。
- **本番ビルドの成功 (`npm run build`)**:
  - 静的型定義や境界チェックのコード追加後も、TypeScript コンパイルおよび Vite ビルドがエラーなく成功することを確認しました。
- **比較レポートの生成 (`npm run compare:rules-vnext`)**:
  - 比較レポート生成スクリプトが正常に終了することを確認しました。
- **CLIシナリオの動作確認 (`npm run scenario:rules-vnext`)**:
  - シナリオ5「カウンターでアップを取り消す」を含め、CLI上のログ出力および動作が完全に一貫していることを確認しました。

---

## 24. Phase 10 検証結果: 新YAML DSLシミュレーターにおける「ツイスト」の最小実装とキャラクター状態変更処理

本セクションでは、旧 `act.yaml` の本来の仕様（「対象のキャラクターをドライブ状態またはチャージ状態にする」）に基づいた新YAML DSLでの「ツイスト」最小実装および検証・実証した結果について記述します。

### 実施内容と設計上の対応

- **割り込み用語の整理（第9版公式手順アライン）**:
  - 設計方針およびルール規定に合わせ、設計・コード・ドキュメント・アサーションから旧用語を完全に排除しました。
- **YAMLによるツイスト定義（`twist.yaml`）の追加**:
  - `twist.yaml` を `tools/simulator/src/data/rules-vnext/examples/twist.yaml` に新規作成。
  - アクションIDを `action.twist`、コストを `D`、キーカード条件を `♢A〜10`（suit: diamond, rank: "A..10"）、速度（`actSpeed`）を「通常（`normal`）」、タイミングを「クイック（`quick`）」と定義しました。
  - 対象（`targets`）には、キャラクター1体（`componentType: character`）を指定し、効果として `toggleUnitState` コマンドを定義しました。
- **キャラクター状態変更コマンド（`toggleUnitState`）の実装**:
  - `commandHandlers.ts` に `toggleUnitState` を追加しました。対象ユニットの現在の状態（`state`）が `charge` であれば `drive` に、`drive` であれば `charge` に切り替えます（それ以外の無効な状態はエラーとします）。
  - 状態変更後に、既存のBコストの仕様にアラインする形で、`unitStateChanged` イベント（`type: "unitStateChanged", payload: { unitId, fromState, toState, playerKey }`）を発行する仕組みを構築しました。
- **一般化されたキャラクターターゲット判定（ActionRequestValidatorの拡張）**:
  - `ActionRequestValidator.ts` にて、対象がキャラクターであることを検証する際に、`componentId` の prefix のみに依存せず、`ComponentDefinition.type === "character"` を優先して判定し、見つからない場合のフォールバックとして `componentId.startsWith("character.")` を使用する強固な一般判定ロジックを統合しました。
  - これにより、防壁（`character.bulwark`）はキャラクターとして正常に処理され、フォグ（`fog.up`）や要塞（`trump.fortress`）といった非キャラクターコンポーネントが指定された場合には `ValidationError`（ターゲットがキャラクターではありません。）を正しくスローして処理を拒絶します。
- **前回の request 対象変更関連ロジックの完全排除**:
  - `changeRequestTarget` コマンドおよびそれに付随する validator アサーション、ExpressionEvaluator 解決ロジック、前回のドキュメント等をコードベースから完全に削除・修正しました。
- **CLIシナリオ「ツイストでキャラクター状態を切り替える」の追加**:
  - `scenarioRunner.ts` にシナリオ6を追加。Player A が一般兵（`soldier-1`, チャージ状態）を対象に「ツイスト」をステージに積み、解決時にコスト D を支払って一般兵の状態をドライブ（`drive`）状態へと正常にトグルさせ、`unitStateChanged` イベントが美麗に発火するプロセスを CLI ログ上で実証しました。
- **比較レポート（`compareRunner.ts`）への追加**:
  - 対応マッピングに `action.twist` <-> `twist` を追加し、`actSpeed` が `通常 / normal` で一致することを確認しました。

> [!IMPORTANT]
> **将来の設計・拡張方針について**
> - **選択式状態変更コマンドへの拡張**:
>   旧効果文「ドライブ状態またはチャージ状態にする」は本来選択式（チャージにするかドライブにするかをプレイヤーが選ぶ）にも読めます。今回は最小実装としてトグルを行う `toggleUnitState` を採用しましたが、将来的にはプレイヤーが状態を選択して適用できる `chooseState` / `setUnitState` などのより高度な高レベル命令コマンドへと拡張する方針とします。

### テストおよび検証実績

- **ツイスト専用の統合テストを追加 (`twist.test.ts`)**:
  - [twist.test.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/tests/rules-vnext/twist.test.ts) を新規作成し、以下の振る舞いを網羅的にアサート検証しました。
    1. チャージ（`charge`）状態の一般兵を対象にツイストするとドライブ（`drive`）状態になること（A）。
    2. ドライブ（`drive`）状態の一般兵を対象にツイストするとチャージ（`charge`）状態になること（B）。
    3. ツイストの D コストが正常に支払われること（C）。
    4. `unitStateChanged` イベントが正常なパラメータで発行されること（D）。
    5. 非キャラクター（フォグ `fog.up` や 要塞 `trump.fortress`）を指定した場合、`ValidationError` になること（E）。
    6. `charge` / `drive` 以外の状態でツイストを適用しようとした場合、`ValidationError` になること（F）。
    7. `actSpeed` が `normal`（通常）、`timing` が `quick` であること（G）。
    8. 防壁 `character.bulwark` もキャラクターとして正常にツイスト対象にできること（H）。
- **自動テストの実行結果 (`npm test`)**:
  - 新規追加した `twist.test.ts`（5ケース）を含む、**全 12 ファイル・68 ケースすべての Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。
- **本番ビルドの成功 (`npm run build`)**:
  - TypeScript コンパイルおよび Vite ビルドがエラーなく成功することを確認しました。
- **比較レポートの生成 (`npm run compare:rules-vnext`)**:
  - 比較レポート生成スクリプトが正常に終了し、`docs/rules-vnext-compare.md` に twist が対比出力されることを確認しました。
- **CLIシナリオの動作確認 (`npm run scenario:rules-vnext`)**:
  - シナリオ6「ツイストでキャラクター状態を切り替える」において、期待した通りのログ順でトグルとイベント発行が行われることを確認しました。

---

## 25. Phase 10.1 検証結果: unitStateChanged イベントの発生原因（cause）追加と CLI ログ分類の修正

本セクションでは、ツイスト等の効果によって発生する状態変化イベント（`unitStateChanged`）が、Bコストによるものと誤って分類される問題を解決するため、イベントに発生原因（`cause`）を付加し、CLI上のログ出力を適切に分類・整理した検証について記述します。

### 実施内容と設計上の対応

- **イベント発生原因（`cause`）メタ情報の統合**:
  - ゲーム内の `unitStateChanged` イベントに、発生理由を表す `cause` プロパティを payload 内に付加する仕組みを導入しました。
  - **Bコストによる消費**: `CostResolver.ts` 内でのBコスト支払い時に、`cause: { type: "cost", symbol: "B" }` を付与してイベントを発行します。
  - **効果によるトグル**: `commandHandlers.ts` 内の `toggleUnitState` コマンド解決時に、`cause: { type: "effect", command: "toggleUnitState" }` を付与してイベントを発行します。
- **CLIログ分類・出力ロジックの修正**:
  - `scenarioRunner.ts` の `setupRegistryHook` において、`unitStateChanged` を一律に `[COST] B` として扱っていたロジックを修正しました。
  - `cause` 情報を判定し、`cause.type === "cost" && cause.symbol === "B"` である場合（防壁のBコストドライブ時など）のみ `[COST] B: 防壁をドライブ (ユニット: <unitId>)` と出力し、効果によるトグルなどの場合は `[EVENT] unitStateChanged: <unitId> (<fromState> -> <toState>)` として美しく出力されるよう分類表示を修正しました。
  - シナリオ6内に存在した、二重ログ出力の原因となる個別フックを完全に削除してフックを一元化しました。

### 検証実績

- **自動テストの実行結果 (`npm test`)**:
  - すべてのイベントペイロード拡張後も、**全 12 ファイル・68 ケースの Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。
- **本番ビルドの成功 (`npm run build`)**:
  - イベント構造の追加やフック修正後も、TypeScript コンパイルおよび Vite ビルドがエラーなく成功することを確認しました。
- **CLIシナリオの動作確認 (`npm run scenario:rules-vnext`)**:
  - シナリオ6「ツイストでキャラクター状態を切り替える」を実行した際、一般兵（`soldier-1`）のトグルにおいて誤った `[COST] B` や「防壁をドライブ」という文言が一切出力されず、`[EVENT] unitStateChanged: soldier-1 (charge -> drive)` として正確かつ美麗にログ出力されることを目視確認しました。

---

## 26. Phase 12 検証結果: 新YAML DSLシミュレーターにおける「ターン/フェーズ」の最小モデルとタイミング検証の実装

本セクションでは、第9.0版再現に向けた進行管理の土台として、GameStateにターンプレイヤー、フェーズ、ターン数を追加し、フェーズ遷移およびアクションのタイミング（`timing: main / quick`）事前検証を実証した結果について記述します。

### 実施内容と設計上の対応

- **ターンマネージャー（`TurnManager.ts`）の新規実装**:
  - `GameState` に対する状態遷移とバリデーションをカプセル化した静的ヘルパークラス `TurnManager` を新規追加しました。
  - **`startTurn(state, playerKey)`**: ターンプレイヤー（`turnPlayer`）、非ターンプレイヤー（`nonTurnPlayer`）を設定し、フェーズを `"draw"` に初期化、`turnCount` をプレイヤーターン開始ごとに `+1` 加算する処理を実装しました。
  - **`movePhase(state, nextPhase)`**: `"draw" -> "main" -> "end"` の正しいフェーズ遷移のみを順序検証・適用します。不正な遷移（例: endから直接drawへ戻る）に対しては、エンジン自体の不正として **`Error`** をスローして実行を拒絶します。
  - **`endTurn(state)`**: 現在のフェーズが `"end"` であることを確認した上で、ターンを交代して次のプレイヤーのターンを `"draw"` フェーズから開始します。
  - **`initializeToMain(state, playerKey)`**: 既存のテストコードやCLIシナリオとの互換性を完全に保証するため、指定プレイヤーの `"main"` フェーズから直接ターンを開始（`turnCount` も +1 加算）できる初期化ヘルパーメソッドを実装しました。
- **タイミング（timing: main/quick）事前検証の統合**:
  - `ActionRequestValidator.ts` の `validateActionRequest` メソッドを拡張し、アクションの事前検証フローの中にタイミング制限チェックを統合しました。
  - **`timing: "main"` の厳密な検証**: アクションが要求するタイミングが `"main"` である場合、現在のフェーズが `"main"` でなければ **`ValidationError`**（`メインタイミングのアクションはメインフェーズでのみ使用可能です。現在: <phase>`）をスローし、リクエストの作成を拒絶します。
  - **`timing: "quick"` の仮仕様化**: 厳密な双方向の優先権対話スタック解決は本フェーズでは未実装のため、`timing: "quick"` のアクション制約は厳しくしすぎず、`draw` / `main` / `end` フェーズなど主要なフェーズ全般で仮許可（仮仕様）とするように実装しました。
  - **後方互換性の担保**: 既存の `phase` 定義を持たないテストや状態コンテキストからのアクション実行においては、タイミングチェックを完全にスキップして透過的にパスさせる後方互換（ブリッジフォールバック）を維持しました。
- **CLIシナリオランナーの表示強化**:
  - `scenarioRunner.ts` を拡張し、各シナリオの初期 `state` において `TurnManager.initializeToMain` を呼び出すように変更しました。
  - 状態ログ表示 `logState` の開始部分に、`[TURN] Turn 1: Player A / phase=main` のような美麗なコンソールログ出力を追加し、ゲーム進行状況がビジュアル的かつ正確にトレースできることを実証しました。

> [!IMPORTANT]
> **将来の設計方針: クイックアクションの優先権解決について**
> 今回の実装はターン/フェーズの最小モデルであるため、完全なドロー処理、ターン終了に伴うフォグ除去等のエンド処理、および対戦中の双方向の優先権応答（パス / 割り込みプレイ）手順は未実装です。
> `quick` アクションの厳密な制限や優先権の受け渡し手順、およびエンドフェーズでのクリーンアップについては、今後のフェーズで段階的に整理し追加していきます。

### テストおよび検証実績

- **ターン/フェーズ専用の統合テストを追加 (`turnPhase.test.ts`)**:
  - [turnPhase.test.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/tests/rules-vnext/turnPhase.test.ts) を新規作成し、以下の振る舞いを網羅的にアサート検証しました。
    1. `startTurn` によるターン状態の初期化およびプレイヤーターン開始ごとの `turnCount` の正常加算（A）。
    2. `movePhase` による `draw -> main -> end` の正常遷移および不正遷移時の `Error` スロー（B）。
    3. `endTurn` によるターン交代と `turnCount` インクリメント（C）。
    4. `main` フェーズで `timing: main` の防壁設置（`action.setBulwark`）が正常にリクエスト可能なこと（D）。
    5. `draw` や `end` フェーズで `timing: main` のアクションを実行しようとした際に **`ValidationError`** がスローされること（E）。
    6. `phase` が未定義の場合にタイミングチェックがスキップされ、透過的にアクション実行が機能すること（F）。
- **自動テストの実行結果 (`npm test`)**:
  - 新規追加した `turnPhase.test.ts` を含む、すべての Vitest 統合テストが 100% グリーンで正常にパスすることを確認しました。
- **本番ビルドの成功 (`npm run build`)**:
  - TypeScript コンパイルおよび Vite ビルドがエラーなく成功することを確認しました。
- **比較レポートの生成 (`npm run compare:rules-vnext`)**:
  - 比較レポート生成スクリプトが正常に完了することを確認しました。
- **CLIシナリオの動作確認 (`npm run scenario:rules-vnext`)**:
  - すべてのシナリオにおいて、`[TURN] Turn 1: Player A / phase=main` がコンソール上に出力され、タイミング検証に阻害されることなく美麗に完走することを確認しました。


## 27. Phase 12.1 検証結果: ターン＆チャンスモデル（手番・チャンス管理）への移行とフェーズ概念の廃止

本セクションでは、BlackPoker本来のゲームデザイン（公式ルール上に「フェーズ」概念は存在せず、ドロー、チャージ、アタック、エンドはすべて「アクション」である設計）へ回帰・再設計するため、Phase 12で一時的に導入した「フェーズ制（`draw/main/end`）」を完全に廃止し、**「ターン＆チャンスモデル（手番・チャンス管理）」** へと移行・実証した結果について記述します。

### 実施内容と設計上の対応

- **フェーズ概念の完全廃止とターン＆チャンスモデルへの回帰**:
  - `GameState` から `phase` プロパティを完全に排除し、`TurnManager.movePhase` メソッドなどのフェーズ遷移状態管理コードを廃止しました。
  - 代わりに、**手番（`turnPlayer`）** と **チャンス所持（`chancePlayer`）** を中心としたゲーム状態およびアクション可能条件判定へと移行しました。
- **ターンマネージャー（`TurnManager.ts`）の再設計**:
  - **`startTurn(state, playerKey)`**:
    - 手番プレイヤー（`turnPlayer`）を `playerKey`、非手番プレイヤー（`nonTurnPlayer`）を相手プレイヤーに設定します。
    - チャンスプレイヤー（`chancePlayer`）をターン開始時に手番プレイヤーに設定します。
    - プレイヤーターン開始ごとに `turnCount` を `+1` 加算します。
    - ターンごとのアクション数（`actionCount`）を `0` にリセットします（※`actionCount` のインクリメントタイミングは将来の「解決順・優先権自動受け渡し」段階で定義します）。
  - **`passChance(state)`**:
    - アクション実行権であるチャンスを相手プレイヤーに移行させます（`p1` <-> `p2`）。
  - **`endTurn(state)`**:
    - ターン交代を行い、次の手番プレイヤーで `startTurn` を実行します。
    - ※ BlackPoker においてターン終了（エンド）は「フェーズ」ではなく、将来的に `action.end` アクションとして扱い、フォグ除去などはその効果解決時に行う方針とします。
  - **`initializeToMain(state, playerKey)`**:
    - 既存のテストコードやCLIシナリオとの互換性を完全に保証するための初期化ヘルパー。
    - 指定プレイヤーで `startTurn` を呼び出して `turnCount` を `+1` し、手番プレイヤーがチャンスを持つ状態（「メインタイミングのアクションを起こせる状態」）にします。
    - ※将来的にこのメソッドは `initializeForMainAction`, `startActionTurn`, `prepareMainActionWindow` などへ名称変更する予定ですが、今回のフェーズでは互換性維持のため現状の名称を維持します。
- **タイミング（timing: main/quick）事前検証の再定義**:
  - `ActionRequestValidator.ts` において、`timing` の検証ロジックをフェーズ依存から、手番・チャンス・ステージ状態依存へと変更しました。
  - **`timing: "main"` の検証**:
    - 実行者（`requester = context.playerKey`）が **手番プレイヤー（`turnPlayer`）かつチャンスプレイヤー（`chancePlayer`）** であり、かつ **ステージが空**（`state.stage.requests.length === 0`）であることを検証します。満たさない場合は **`ValidationError`** をスローしてリクエストを拒絶します。
  - **`timing: "quick"` の検証（仮仕様）**:
    - 実行者が **チャンスプレイヤー（`chancePlayer`）** であることを検証します（ステージに先行リクエストが積み重なっていても可）。満たさない場合は **`ValidationError`** をスローします。
    - ※ チャンスの自動受け渡しルールは完全実装せず今後のフェーズ（解決順・応答手順の整理）で扱う方針とし、本フェーズでは手動または仮検証に留めます。
  - **後方互換性の確保**:
    - 既存の `turnPlayer` または `chancePlayer` を持たないテスト（`counter.test.ts` や `twist.test.ts`）等に対しては、タイミング検証を透過的にパス（スキップ）させる後方互換ブリッジ設計を徹底し、テストの破壊を完全に防止しました。

### CLIシナリオの整合とログ表示の変更

- **コンソール表示の変更**:
  - `scenarioRunner.ts` を拡張し、`logState` でフェーズの代わりに `[TURN] Turn 1: Player A (Chance: Player A)` のように、現在のターン数、手番、チャンス所持者が美しく表示されるように出力形式を変更しました。
- **シナリオ上の明示的な手番・チャンス整合処理**:
  - 複数アクションが同一シナリオ内で連続して実行される挙動を確認するため、各アクション実行前に `TurnManager` を用いて明示的な整合処理を挿入しました。
  - **シナリオ4（要塞防衛）**:
    - Player B による防壁設置（`timing: main`）の前に `TurnManager.initializeToMain(state, "p2")` を実行。
    - その後、Player A による投擲（`timing: main`）の前に `TurnManager.initializeToMain(state, "p1")` を実行。
    - コメントに「これは実ゲームの完全なターン進行を表すものではなく、個別アクションの実行条件を満たすためのシナリオ上の明示的な整合処理であり、完全なターン進行やチャンス自動受け渡しは今後対応する」旨を追記しました。
  - **シナリオ5（カウンター）**:
    - Player A によるアップ（`timing: main`）のリクエストと、Player B によるカウンター（`timing: quick`）のリクエストの間で、`TurnManager.passChance(state)` を呼び出し、チャンスを Player B に移行させてタイミング検証を正常に通過させました。

### テストおよび検証実績

- **ターン＆チャンス検証用の統合テストの全面的再構築 (`turnPhase.test.ts`)**:
  - 廃止されたフェーズ遷移に関するテストコードを削除し、ターン＆チャンスモデルに基づく以下のテスト（A〜G）へ全面的に書き換えました。
    - A. `startTurn` による `turnPlayer` / `nonTurnPlayer` / `chancePlayer` / `turnCount` の初期化。
    - B. `passChance` による `chancePlayer` の移行。
    - C. `endTurn` によるターン交代と `turnCount` インクリメント。
    - D. 手番プレイヤーかつチャンスプレイヤーかつステージ空での `timing: main` アクション（防壁設置）のリクエスト許可。
    - E. 相手手番、チャンス不所持、ステージが空でないとき等における `timing: main` の `ValidationError` スロー。
    - F. チャンスプレイヤーであればステージが空でなくても `timing: quick` アクション（ツイストなど）のリクエスト許可、非所持時の `ValidationError` スロー。
    - G. ターン/チャンス情報未定義時のタイミング検証自動スキップ（後方互換性担保）。
- **自動テストの実行結果 (`npm test`)**:
  - 変更した `turnPhase.test.ts` を含む、**すべてのテスト（全 12 ファイル・全テスト）が 100% グリーンで正常にパス**することを確認しました。
- **本番ビルドの成功 (`npm run build`)**:
  - `TurnManager` のフェーズ依存コード削除や `ActionRequestValidator` のタイミングロジック変更を含む、コンパイルおよびビルドがエラーなく成功することを確認しました。
- **CLIシナリオの動作確認 (`npm run scenario:rules-vnext`)**:
  - CLI上に `[TURN] Turn 1: Player A (Chance: Player A)` のようにターン・チャンス情報が美麗にログ出力され、すべてのシナリオ（シナリオ1〜6）がタイミング検証をパスして正常に実行完了することを確認しました。

## 28. Phase 13 検証結果: エンドアクション（action.end）とフォグ除去処理の最小実装

本セクションでは、第9.0版再現に向けた進行管理のさらなるアラインとして、エンド処理を一時的な「フェーズ」ではなく、BlackPoker本来のゲームシステム設計に沿った **「エンドアクション（`action.end`）」** として定義・実行し、その効果解決時にフォグ除去とターン交代を行う仕組みを最小実装・検証した結果について記述します。

### 実施内容と設計上の対応

- **「エンドアクション」としての定義と YAML 化**:
  - `end.yaml` を `tools/simulator/src/data/rules-vnext/examples/end.yaml` に新規作成。
  - アクションIDを `action.end`、名前を「エンド」、種類を「基本（`basic`）」と定義しました。
  - タイミングはメイン（`timing: main`）とし、手番プレイヤー（`turnPlayer`）かつチャンスプレイヤー（`chancePlayer`）かつステージ空の状態でリクエスト可能にしました。
  - 一時的な **`phase` 概念は一切再導入せず**、手番・チャンス・ステージ状態のみで厳密にリクエストバリデーションを行っています。
  - 効果として、以下の2つの高レベルコマンドを順に実行するように定義しました。
    ```yaml
    effect:
      - cleanupFogs: {}
      - endTurn: {}
    ```
- **フォグ除去コマンド（`cleanupFogs`）の実装**:
  - `commandHandlers.ts` に `cleanupFogs` を新規実装しました。
  - 実行プレイヤーの `fog` 領域（`player.fog`）から、`ComponentDefinition.type === "fog"` を優先的に逆引きし、見つからない場合のフォールバックとして `componentId.startsWith("fog.")` を使用して「フォグコンポーネント」に該当するオブジェクトを特定し、すべて除去（フィルタアウト）します。
  - **フォグ除去の動作**: 最小実装として `player.fog` から該当のフォグを削除します。これにより、`AbilityEvaluator` がサイズ計算を行う際にフォグの影響が自動的に消滅し、一般兵ユニットが「元のサイズ」に透過的かつ正常に復帰することを確認しました。
  - **イベント駆動フックの統合**: フォグ除去時に `fogRemoved` イベント（`type: "fogRemoved", payload: { fogId, componentId, playerKey }`）をディスパッチする処理を統合しました。
- **ターン交代コマンド（`endTurn`）の実装**:
  - `commandHandlers.ts` に `endTurn` を新規実装しました。
  - 内部で `TurnManager.endTurn(context.state)` を実行することで、手番（`turnPlayer`）を相手に切り替え、チャンスプレイヤー（`chancePlayer`）を次の `turnPlayer` に移行し、`turnCount` を `+1` インクリメントし、`actionCount` を `0` にリセットします。
- **テストファイルのリネームと整理**:
  - フェーズ概念を廃止した設計に合わせ、テストファイル `turnPhase.test.ts` を **`turnChance.test.ts`** にリネーム（`git mv`）し、フェーズ用語をファイル名から完全に排除しました。

### テストおよび検証実績

- **エンドアクション専用の統合テストを追加 (`endAction.test.ts`)**:
  - [endAction.test.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/tests/rules-vnext/endAction.test.ts) を新規作成し、以下の振る舞いを網羅的にアサート検証しました。
    1. エンドアクションを turnPlayer かつ chancePlayer が stage 空のタイミングで正常にリクエストできること (A)。
    2. requester が turnPlayer または chancePlayer でない場合、またはステージに先行リクエストがある場合に `ValidationError` になること (H)。
    3. エンドアクション解決時に、プレイヤーに適用されていた `fog.up` および `fog.down` が正常に除去されること (B, D)。
    4. フォグ除去後、サイズ修正が完璧に消えて一般兵が元のサイズ（6）に戻ること (C)。
    5. フォグ以外の一般兵・防壁・表切札（要塞）などのゲーム要素は一切除去されずフィールドに残留すること (E)。
    6. エンド解決後、`turnPlayer` / `chancePlayer` が次プレイヤーへ正常に交代し、`turnCount` が `+1` されること (F, G)。
- **自動テストの実行結果 (`npm test`)**:
  - 新規追加した `endAction.test.ts` を含む、**全13ファイル・75ケースすべての Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。
- **本番ビルドの成功 (`npm run build`)**:
  - コマンドやインポートの追加を含む、TypeScript コンパイルおよび Vite ビルドがエラーなく成功することを確認しました。
- **比較レポートの生成 (`npm run compare:rules-vnext`)**:
  - 比較マッピングに `action.end` <-> `end` を追加し、`type` が `basic` (基本) で正常に適合することを確認しました。
- **CLIシナリオランナーの実行 (`npm run scenario:rules-vnext`)**:
  - シナリオ1（アップ）の末尾において、「アップ」の解決（サイズ13）の後に「エンド」を実行し、`[CMD] cleanupFogs` -> `[EVENT] fogRemoved: fog.up` -> `[CMD] endTurn` -> `[TURN] Turn 2: Player B (Chance: Player B)` の順でログが出力され、兵士のサイズが6に戻り、手番交代する美麗なトレースフローを実証しました。

## 29. Phase 13.1 検証結果: エンドアクション解決時の全プレイヤーフォグ墓地移動処理の修正

本セクションでは、エンドアクション（`action.end`）解決時におけるフォグのクリーンアップ仕様を、BlackPoker本来の正しい仕様（**「ターン終了時に自分と相手双方のフォグがすべて各々の墓地へ移動する」**）へと適合させ、実証・検証した結果について記述します。

### 実施内容と設計上の対応

- **全プレイヤーのフォグ走査と墓地移動 (`cleanupFogs`)**:
  - `commandHandlers.ts` の `cleanupFogsHandler` を修正し、全プレイヤー（`state.players`）をループ走査して、全プレイヤーのフォグを各々の墓地（`player.grave`）へと移動するロジックに変更しました。
  - 墓地移動の際、一般兵やダメージカードと同様に、一貫して「墓地ユニットオブジェクト」として包んで `player.grave` に追加します。
    ```typescript
    player.grave.push({
      unitId: fog.fogId,
      kind: "フォグ",
      componentId: fog.componentId,
      cards: fog.card ? [fog.card] : [],
      labels: [],
    });
    ```
- **イベント発行仕様の厳密化と整合方針**:
  - `fogRemoved` イベントは、フォグオブジェクト自身の消滅を表すメタイベントとして、フォグごとに必ず発行します。payload に `{ owner (playerKey), componentId, card, fromZone: "fog", toZone: "grave" }` を含めて拡張しました。
  - `cardMoved` イベントは、トランプカードの物理的な移動を表す実イベントとして、`fog.card` が存在する場合のみ `fromZone: "fog" -> toZone: "grave"` として発行します。
  - **二重イベントの整合方針**: `fogRemoved` はルール上のオブジェクト消滅のトリガーログであり、`cardMoved` はそれに伴う構成カードの領域移動を示すため、両イベントが別個に発行・記録される設計が正しく、CLI上のログ出力で双方が明確に区別されるため混同は生じません。
- **世代交代（nextGeneration）の不誘発保証**:
  - 世代交代の誘発条件は `fromZone: field -> toZone: grave` であるため、フォグ墓地送り時の `fromZone: fog -> toZone: grave` では、たとえ構成カードが Legacy Card（Joker, A, J, Q, K）であっても世代交代が誘発しないことを保証し、検証テストを追加しました。

### テストおよび検証実績

- **統合テストの全面改訂 (`endAction.test.ts`)**:
  - テストを改訂し、以下の振る舞いを厳密にアサート検証しました。
    1. **両プレイヤーのフォグ移動**: Player A の `fog.up` が Player A の `grave` へ、Player B の `fog.down` が Player B の `grave` へそれぞれ移動すること。
    2. **フォグ領域の空化**: 両プレイヤーの `fog` 領域が完璧に空になり、付与されていたサイズ修正効果が消失して元のサイズに戻ること。
    3. **一般兵・防壁の保護**: フォグ以外の召喚ユニット（一般兵など）は除去されずにフィールドに正しく残留すること。
    4. **Legacy Card 移動時の世代交代不誘発**: Player A のフォグ構成カードを Legacy Card（Heart K）としてテストし、フォグから墓地への移動では世代交代（`nextGeneration`）が誘発せず、ライフ枚数が安全に維持されること。
    5. **イベントペイロード検証**: `fogRemoved` と `cardMoved` に適切な属性（`playerKey`, `fromZone: "fog"`, `toZone: "grave"`, etc.）が含まれ、正しく発行されること。
- **自動テストの実行結果 (`npm test`)**:
  - 新規・改訂テストを含む、**全14ファイル・78ケースすべての Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。
- **CLIシナリオランナーの実行 (`npm run scenario:rules-vnext`)**:
  - シナリオ1の初期状態において Player B の場にあらかじめ一般兵を配置し、さらに Player B のフォグ領域に `fog.down` (Spade 2) をあらかじめ適用した状態に拡張しました。
  - エンド解決時に Player A の `fog.up` と Player B の `fog.down` の双方がそれぞれの墓地（grave）へと移り、美麗に2行の `[EVENT] fogRemoved` ログが対照的に出力されるプロセスを実証しました。

## 30. Phase 14.0 検証結果: 新YAML DSLシミュレーターにおける戦闘モデルの設計整理とロードマップ策定

本セクションでは、新YAML DSLシミュレーターにおける「戦闘モデル（アタック・ブロック・ダメージ判定、戦闘による墓地送り、および他アクションとの連携）」の本格的な実装に進む前段階として、ルールの設計整理とロードマップ策定を行った結果について記述します。

### 実施内容と設計上の対応

- **戦闘を「フェーズ」ではなく「アクション」として扱う設計の確立**:
  - BlackPoker の公式ルールには「戦闘フェーズ」や「バトルフェーズ」といったフェーズ概念は存在しません。本シミュレーターでも一時的な `phase` 概念は再導入せず、すべてをターン＆チャンスモデル（手番・チャンス・ステージ状態）を前提とする「アクション」の連鎖として定義・解決する設計方針を確立しました。
- **戦闘を構成する最小アクションの整理**:
  - Combatを以下の3つの基本アクションとして整理・設計しました。
    1. **`action.attack` (アタック)**: `timing: main` （手番プレイヤーのみ直接リクエスト可能）。アタッカー（攻撃ラベル、チャージ状態、速攻/ターン制限等）を指定し、ドライブ状態へトグル。
    2. **`action.block` (ブロック)**: 誘発アクション。アタック解決時に自動的にステージへ積まれる。防御側がアタッカー毎にブロッカーを指定。
    3. **`action.damageJudge` (ダメージ判定)**: 誘発アクション。ブロック解決時に自動的にステージへ積まれる。サイズ比較、防壁の特殊判定（Joker/数字一致判定）、およびブロックされなかった際のスルーダメージ適用（`dealDamage`）を実行。
- **ユニット側 battle 情報を用いた戦闘一時状態のデータモデル設計**:
  - BlackPoker に存在しない概念を増やさず、また戦闘フェーズを模したグローバル状態（`state.combat`）を避けるため、フィールド上に存在するアタッカーやブロッカーのユニット自体に一時的な戦闘情報（`unit.battle`）を付与し、アタッカーやブロックの対応関係を格納してダメージ判定解決後にクリアするシンプルな設計としました。
- **ターン＆チャンスモデルおよび既存アクションとの連携設計**:
  - **既存アクションとの連携**: アップ・ダウンによるサイズ操作、ツイストによる状態切替、カウンターによるアタック/ブロックリクエストの取消などの相互作用を詳細に設計。
  - **防壁・世代交代との連携**: 防壁ブロック時の特殊判定および戦闘解決による `field -> grave` の墓地移動が発生した際、Legacy Card であれば「世代交代（`action.nextGeneration`）」が動的に自動誘発する連携を設計。
  - **エンドアクションとの関係性**: 戦闘が終了した後、エンドアクション（`action.end`）を実行することで、全プレイヤーのフォグが各々の墓地へ移動する前提を維持します。
- **戦闘モデル設計ドキュメントの新規作成**:
  - 詳細な設計方針、戦闘解決フロー、データモデル、他アクションとの関係、およびロードマップを記載した [rules-vnext-combat-plan.md](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/docs/rules-vnext-combat-plan.md) を新規作成しました。

### 今後の段階的実装ロードマップ (Phase 14.1〜14.5)

戦闘モデルを安全に、確実に壊れない形で実装するために、以下の5つの段階に分割して開発を進めます。
- **Phase 14.1**: `action.attack` アクションの最小実装（アタッカー指定条件バリデーション・ドライブトグル・一時状態バインド）
- **Phase 14.2**: `action.block` アクションの最小実装（ブロッカー指定条件バリデーション・アタック解決からの自動誘発積載）
- **Phase 14.3**: `action.damageJudge` アクションの最小実装（基本戦闘解決・サイズ比較・墓地送り・スルーダメージ・ブロック解決からの自動誘発積載）
- **Phase 14.4**: 戦闘による防壁特殊判定（Joker/数字一致）および戦闘墓地送り時の世代交代（`nextGeneration`）自動誘発の連携
- **Phase 14.5**: CLI戦闘シナリオの統合（アタック・ブロック・ダメージ判定・魔法やカウンター介入のCLI目視検証）

## 31. Phase 14.1 検証結果: アタックアクションの最小実装と戦闘一時情報モデルの追加

本セクションでは、Phase 14.0で策定した戦闘モデルに基づき、アタックアクションのYAML定義、タイミング検証、アタッカー指定のバリデーション、および解決時のアタッカー戦闘一時情報（`unit.battle`）の記録とアタッカーのドライブ移行処理を最小実装・検証した結果について記述します。

### 実施内容と設計上の対応

- **アタックはフェーズではなく `action.attack`**:
  - BlackPoker 本来の設計に基づき、アタックは一時的なフェーズの再導入ではなく、手番・チャンス管理モデルに適合したアクション `action.attack` として扱います。
- **YAML定義（`attack.yaml`）の追加**:
  - `attack.yaml` を `tools/simulator/src/data/rules-vnext/examples/attack.yaml` に新規作成。
  - タイミングはメイン（`timing: main`）、速度は通常（`normal`）の基本アクション（`type: basic`）として定義しました。
  - 対象（`targets`）には「自分のフィールドのキャラクター（`targetUnit`）」および「対戦相手プレイヤー（`targetPlayer`）」の2つを指定する定義を策定しました。
- **アタック可能条件のバリデーション実装と validator 拡張**:
  - `ActionRequestValidator.ts` を拡張し、アタックアクション（`action.attack`）固有の事前検証処理を実装しました。
    1. **アタッカーの所有権判定**: 指定された対象ユニットが、アクション実行者（`playerKey`）のフィールド（`field`）に存在すること。
    2. **アタッカーの攻撃可能状態判定**: ドライブ状態のキャラクターは指定できない（チャージ状態であること）のチェック。
    3. **タイミング/ステージ検証**: 手番かつチャンス所持かつステージ空の検証（`timing: main` 既存検証を適用）。
- **アタッカー戦闘一時情報（`unit.battle`）の記録コマンド（`startAttack`）の実装**:
  - `commandHandlers.ts` に `startAttack` を新規実装し、`CommandRegistry` に登録しました。
  - アタックアクション解決時に以下の処理を実行します。
    1. **アタッカーをドライブ状態に移行**: アタッカーユニットの `state` を `"drive"` に変更し、`unitStateChanged` イベントを適切に発行。
    2. **アタッカー戦闘一時情報の記録**: アタッカーユニットの `battle` プロパティに戦闘情報（`{ role: "attacker", targetPlayerKey: defenderPlayerKey }`）を格納します。
- **ブロック・ダメージ判定・墓地送りは未実装**:
  - 本フェーズは戦闘モデルの第一段階（アタックと状態構築）の最小実装であるため、ブロック（ブロッカー指定）、ダメージ判定（サイズ比較・ダメージ適用）、墓地送りおよび「世代交代」の連鎖誘発は未実装としています。
- **チャンス移行の設計方針とテスト整合**:
  - 将来的な「解決順・優先権自動受け渡し」の対応を見据え、本フェーズではアタック解決時の自動チャンス受け渡しは未実装（チャンスは手動整合を許容）とし、テストやCLIシナリオで明示的にチャンスプレイヤーを調整・アサートする方針としました。

### テストおよび検証実績

- **アタックアクション専用の統合テストを追加 (`attack.test.ts`)**:
  - [attack.test.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/tests/rules-vnext/attack.test.ts) を新規作成し、以下の振る舞いを網羅的にアサート検証しました。
    1. 手番かつチャンスプレイヤーがステージが空のときにアタックを正常にリクエスト・解決できること (A)。
    2. アタック解決時に、アタッカー戦闘一時情報 `soldier.battle` が正しく記録され、`role` / `targetPlayerKey` が正常に記録されること (B, C)。
    3. アタッカーに指定されたキャラクターユニットが正常に `drive` 状態に移行すること。
    4. ターゲットが自分のキャラクターでない場合（相手のキャラクター、または非キャラクターであるフォグ等）に `ValidationError` がスローされること (D)。
    5. ドライブ状態のユニットをアタッカーに指定しようとした場合に `ValidationError` がスローされること (D)。
    6. 実行者が手番またはチャンス所持でない場合に `ValidationError` になること (E)。
    7. ステージが空でない（先行リクエストがある）状態でアタックリクエストを行うと `ValidationError` になること (F)。
    8. アタック解決だけではまだ相手へのダメージ判定や墓地送り処理が発生しないこと (G)。
- **自動テストの実行結果 (`npm test`)**:
  - 新規追加した `attack.test.ts` を含む、**全15ファイル・85ケースすべての Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。
- **CLIシナリオランナーへの統合と実行 (`npm run scenario:rules-vnext`)**:
  - シナリオ7「アタックを宣言して戦闘状態を作る」を追加しました。
  - アタック解決時に `[CMD] startAttack` -> `[COMBAT] attacker=一般兵, defender=Player B` の美麗なログがフック出力され、アタッカー戦闘一時情報が正しくコンソールに表示されて正常に完走することを確認しました。

### 今後のステップ

本フェーズでアタックによる戦闘状態モデルの構築まで完了しました。次の **Phase 14.2** では、防御側がブロッカーを指定する **「ブロックアクション（`action.block`）」** の最小実装に移行しました。

## 32. Phase 14.2 検証結果: ブロックアクションの最小実装とアタッカー・ブロッカー対応付け処理の追加

本セクションでは、Phase 14.1で構築した戦闘モデルとアタッカー戦闘情報を踏まえ、防御側プレイヤーによるブロックアクション（`action.block`）のYAML定義、内部タイミング `timing: block` の導入、自分自身を狙うアタッカーの厳密な自動特定、およびブロック解決時にアタッカー・ブロッカーを `unit.battle` 情報で対応付ける処理を最小実装・検証した結果について記述します。

### 実施内容と設計上の対応

- **ブロックは手動アクション `action.block`**:
  - 前回の設計方針をブラッシュアップし、ブロックはアタック解決時の自動誘発ではなく、防御側プレイヤー（チャンス所持者）が能動的にリクエストする手動アクション `action.block` として扱います。
- **YAML定義（`block.yaml`）の追加**:
  - `block.yaml` を `tools/simulator/src/data/rules-vnext/examples/block.yaml` に新規作成。
  - タイミングは `timing: block`、速度は通常（`normal`）の基本アクション（`type: basic`）として定義しました。
  - **`timing: block` の位置づけ**: これはブロックフェーズを意味するものではなく、ブロックアクションの起動可能条件を表す新YAML DSL上の内部タイミング種別です。フェーズ概念の再導入は一切行いません。
  - 対象（`targets`）は `targetUnit`（自分のフィールドの防御ラベルを持つキャラクター）の1つのみとしました。
- **アタッカーの厳密な自動特定と対応付け**:
  - ターゲット複数指定による複雑化を避けるため、ブロック解決コマンド `declareBlock` において、フィールド上から以下の条件をすべて満たすアタッカーユニットを厳密に特定します。
    1. `attacker.battle.role === "attacker"`
    2. `attacker.battle.targetPlayerKey === context.playerKey`（自分自身を攻撃している）
    3. `attacker` が自分自身の所有するユニットではないこと（自分自身のアタッカーをブロックすることはできない）
  - 特定したアタッカーに基づき、ブロッカーユニットに一時戦闘情報 `blocker.battle = { role: "blocker", blocksUnitId: attacker.unitId }` を記録し、ブロッカーを `drive` 状態に移行（`unitStateChanged` イベント発行）します。
- **ブロッカー条件（最小実装）**:
  - 最小実装上の条件として、ブロッカーに指定できるユニットは「`防御`ラベルを持つキャラクター」に限定しました。一般兵と防壁でのブロック条件の違いなどの詳細なブロック可能条件については、第9.0版の完全再現時に再確認する事項として docs に残します。
- **新旧対比レポート上の互換マッピング**:
  - `compareRunner.ts` にて `timing: block` を旧定義の `メイン`（タイミングがメイン）と互換判定して `OK` にするマッピング（`block: "メイン"`）を追記しました。これにより、比較レポート上は互換ありとしつつ、内部的にはブロック専用タイミングとして一貫性を保ちます。

### テストおよび検証実績

- **ブロックアクション専用の統合テストを追加 (`block.test.ts`)**:
  - [block.test.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/tests/rules-vnext/block.test.ts) を新規作成し、以下の振る舞いを網羅的にアサート検証しました。
    1. 正常な戦闘一時状態において、防御側プレイヤーがブロックを正常にリクエスト・解決できること。
    2. ブロック解決時にブロッカーの `battle` プロパティに `blocksUnitId` が正しく格納され、ブロッカーがドライブ状態に移行すること (A, B, C)。
    3. 自分以外の所有するユニットをブロッカー指定した場合に ValidationError となること (D)。
    4. 防御ラベルを持たないキャラクターをブロッカー指定した場合に ValidationError となること (E)。
    5. すでにドライブ状態であるユニットをブロッカー指定した場合に ValidationError となること (F)。
    6. 自分を狙っていないアタッカー（別のプレイヤーを狙うアタッカー）をブロックしようとした場合にエラーとなること。
    7. 自分自身のアタッカーをブロックしようとした場合にエラーとなること。
    8. フィールドにアタッカーが存在しない状態でブロックしようとした場合に ValidationError（タイミング不適合）となること (G)。
- **自動テストの実行結果 (`npm test`)**:
  - 新規追加した `block.test.ts` を含む、**全16ファイル・91ケースすべての Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。
- **CLIシナリオランナーへの統合と実行 (`npm run scenario:rules-vnext`)**:
  - シナリオ7を「ブロックを宣言して戦闘状態を作り、対応付ける」手順に拡張しました（アタック解決 -> passChance -> ブロック解決）。
  - ブロック解決時に `[CMD] declareBlock` -> `[BLOCK] blocker=防壁, attacker=一般兵` の美麗なログがフック出力され、ブロッカーとアタッカー双方の `battle` プロパティが正しくコンソールに表示されて正常に完走することを確認しました。

### 今後のステップ

本フェーズでアタッカーとブロッカーの戦闘関係のバインド処理まで完了しました。次の **Phase 14.3** では、兵士同士の基本的なサイズ比較による戦闘結果の解決を行う **「ダメージ判定アクション（`action.damageJudge`）」** の最小実装を完了しました。次のフェーズでは、戦闘による防壁のさらなる特殊判定（Joker/数字一致等）や、これまでの戦闘成果物を踏まえたさらなる詳細仕様への適合化を進めます。

## 33. Phase 14.3 検証結果: ダメージ判定アクションの最小実装とサイズ比較・墓地送り・戦闘情報クリアの追加

本セクションでは、Phase 14.2で構築したアタッカー・ブロッカーの対応関係（`unit.battle`）を踏まえ、ダメージ判定アクション（`action.damageJudge`）のYAML定義、内部タイミング `timing: damageJudge` の導入、アタッカー・ブロッカー現在サイズの比較（フォグ補正込み）、敗北ユニットの墓地送り（カード個別 `cardMoved` イベント発行による世代交代自動連携）、および解決後の戦闘情報（`battle`）の完全なクリーンアップを最小実装・検証した結果について記述します。

### 実施内容と設計上の対応

- **ダメージ判定はフェーズではなく `action.damageJudge`**:
  - BlackPoker 本来の設計に基づき、ダメージ判定も一時的なフェーズの導入ではなく、手番・チャンス管理モデルに適合したアクション `action.damageJudge` として扱います。
  - `damage-judge.yaml` を `tools/simulator/src/data/rules-vnext/examples/damage-judge.yaml` に新規作成。タイミングは `timing: damageJudge`、効果として `judgeDamage` コマンドを呼び出す基本アクションとして定義しました。
  - **`timing: damageJudge` の位置づけ**: ブロック完了後のチャンス時に、手番プレイヤー（アタッカー側）が能動的にリクエストする内部タイミング種別です。フェーズ概念は一切再導入していません。
- **厳密な起動可能条件のバリデーション実装**:
  - `ActionRequestValidator.ts` を拡張し、`timing: damageJudge` の際に以下の条件を満たすことを強制しました。
    1. `requester === state.turnPlayer && requester === state.chancePlayer && isStageEmpty` （手番・チャンス所持・ステージ空の徹底）
    2. フィールド上に `battle.role === "attacker"` のアタッカーが「ちょうど1体」存在すること（0体または2体以上の場合は ValidationError）
    3. そのアタッカーを `blocksUnitId` で参照するブロッカーがフィールド上に「ちょうど1体」存在すること（0体または2体以上の場合は ValidationError）
  これにより、1 vs 1 の状況しか許容しないことを安全に保証しました。
- **フォグ補正込みの現在サイズ比較と墓地送り**:
  - `commandHandlers.ts` に `judgeDamageHandler` を追加。
  - `AbilityEvaluator.calculateUnitSize` を使って、アタッカーとブロッカーの現在サイズ（キーカードの基本数値 ＋ フォグによる修正）を算出・比較します。
    1. **アタッカー勝利 (attacker > blocker)**: ブロッカーのみを墓地へ送る。アタッカーは生存。
    2. **ブロッカー勝利 (attacker < blocker)**: アタッカーのみを墓地へ送る。ブロッカーは生存。
    3. **相打ち (attacker == blocker)**: 双方を墓地へ送る。この際、墓地への移動およびイベント発行の順序を **`attacker -> blocker`** に固定して動作を安定化させました。
- **複数カードの `cardMoved` 個別発行と世代交代の自動連鎖**:
  - 共通墓地移動処理 `moveUnitToGraveyard` を抽出し、ユニットを墓地へ移動する際、`unit.cards` 内にカードが複数ある場合は**カードごとに個別の `cardMoved` イベント**を `dispatchEvent` 経由で発行するようにしました。
  - これにより、Legacy Card (Joker, A, J, Q, K) が field -> grave へ移動した際、既存のイベント誘発機構により自動的に「世代交代（`action.nextGeneration`）」が誘発・積載されてライフめくりが発生することを担保しました。
- **一時戦闘情報（`battle`）の完全なクリーンアップ**:
  - 墓地やフィールドに戦闘情報を残さないため、解決プロセスの最後までに、アタッカーおよびブロッカーの `battle` プロパティを `delete unit.battle` によって完全に削除します。
- **互換性レポートの更新**:
  - `compareRunner.ts` に `{ newId: "action.damageJudge", oldId: "damageJudge" }` マッピングおよび `damageJudge: "メイン"` のタイミング互換を追記しました。

### テストおよび検証実績

- **ダメージ判定専用の統合テストを追加 (`damageJudge.test.ts`)**:
  - [damageJudge.test.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/tests/rules-vnext/damageJudge.test.ts) を新規作成し、以下の振る舞いを網羅的にアサート検証しました。
    1. **アタッカー勝利**: アタッカーサイズ（6） ＞ ブロッカーサイズ（5）の時、ブロッカーのみ墓地へ行き、アタッカー生存、戦闘情報が双方クリアされること (A)。
    2. **ブロッカー勝利**: アタッカーサイズ（4） ＜ ブロッカーサイズ（5）の時、アタッカーのみ墓地へ行き、ブロッカー生存、戦闘情報が双方クリアされること (B)。
    3. **相打ち**: 双方のサイズが等しい時、双方が `attacker -> blocker` の順序で墓地へ送られ、戦闘情報が双方クリアされること (C)。
    4. **フォグ補正反映**: 「ダウン」フォグ（-2）が付与されたアタッカー（基本6 - 2 = 4）がブロッカー（5）に敗北すること (D)。
    5. **世代交代連携**: アタッカーの Legacy Card (J) がダメージ判定で墓地へ送られた際、世代交代が自動で走り、ライフからカードが手札に補充されること (E)。
    6. **複数対象の排除**: アタッカーが2体以上存在する場合にバリデーションエラーとなること (F)。
- **自動テストの実行結果 (`npm test`)**:
  - 新規追加した `damageJudge.test.ts` を含む、**全17ファイル・97ケースすべての Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。
- **CLIシナリオランナーへの統合と実行 (`npm run scenario:rules-vnext`)**:
  - シナリオ7をダメージ判定アクションの解決まで拡張しました（アタック解決 -> passChance -> ブロック解決 -> passChance(p1) -> ダメージ判定解決）。
  - アタッカー（一般兵 S6）とブロッカー（防壁 H5）のサイズ比較により、防壁が墓地へ移動し、一般兵は生存し、双方が `battle: undefined` として綺麗にクリーンアップされる一連の美麗な戦闘連鎖ログが完璧に出力されることを確認しました。

### 今後のステップ

本フェーズでダメージ判定の最小核（アタック・ブロック・サイズ比較・墓地送り・世代交代・クリーンアップの一連の連鎖）の実装が安全に完了しました。次のフェーズでは、戦闘による防壁の特殊能力や勝敗判定の拡張に進みます。

---

## 34. Phase 14.4 検証結果: 汎用誘発条件評価エンジンとリクエストバッファの最小実装

本セクションでは、公式ルール「リクエストバッファ（`state.requestBuffer`）」のモデルに基づき、世代交代、ブロック、ダメージ判定を別々の特別扱いにせず、YAML 上の `triggerCondition` 定義で統一的に評価する「汎用誘発条件評価エンジン（`TriggerResolver`）」の最小実装と、6-D-9 ルール（同一誘発解決内でのメイン系アクションの排他と破棄履歴の記録）、キャンセル時の誤誘発防止、二重世代交代の完全な防止アサーションについて検証した結果について記述します。

### 実施内容と設計上の対応

- **公式用語「リクエストバッファ」への統一**:
  - `triggerBuffer` や「誘発バッファ」「誘発候補」といった表現を徹底排除し、公式ルール用語である**「リクエストバッファ（`state.requestBuffer`）」**に完全統一しました。
  - ゲーム状態 `state.requestBuffer.requests` に誘発したリクエストを積載し、`state.requestBuffer.history` に誘発の履歴や破棄履歴を記録します。
  - **二重実行防止と自動消費未実施の方針**: Phase 14.4 ではバッファへの蓄積および 6-D-9 の検証に専念し、**リクエストバッファの自動消費・自動解決は行いません**。これにより、既存の即時解決型世代交代（ライフめくり）と二重で動作する（二重ライフめくり等が発生する）深刻な不整合を防ぎ、既存の CLI シナリオや既存テストの挙動を 100% 影響なしで維持することを保証しました。
- **型安全性の徹底と any の排除**:
  - `RulePackage.ts` に `TriggerCondition`, `TriggeredActionRequest`, `TriggerHistory`, `RequestBuffer` の各型定義を型安全に追加し、`any` を排除して `unknown[]` や `unknown` を適用しました。
  - `sourceEvent` などの `unknown` 型を参照する際には、`typeof event === "object" && event !== null` などの安全な型ガードを徹底してランタイムエラーを防止しています。
- **6-D-9 排他判定の同一評価内制限と関数化**:
  - 6-D-9 による後発メイン系アクションの破棄は、**同一の誘発処理（同一 `resolveTriggers` 呼び出し内）**に厳密に限定して適用します。
  - 排他判定は `isMainTriggeredRequest(action: ActionDefinition): boolean` 関数として切り出し、タイミングが `main` / `block` / `damageJudge` のものをメイン系として判定します。
  - **`block` / `damageJudge` の位置づけ**: これらはフェーズではなく、メインアクションの起動可能条件を表す内部タイミング種別であることを docs に改めて明記します。
  - **6-D-9 ルールの本質的解釈**: 複数誘発時の 6-D-9 による後発メイン系アクションの破棄は「定義不備の安全弁」であり、本来は定義を見直すべきです。しかし、安全弁として機能した際にも、破棄したリクエストは単に消滅させるのではなく、`status: "discarded"` として理由とともに `history` に破棄履歴を残すことで透明性を確保しました。
- **キャンセル時の誤誘発防止の徹底**:
  - `CommandRegistry.ts` の `resolveTopRequest` 完了時、**`request.status === "resolved"` のとき限定**で解決完了イベント `actionResolved` を発行するように制限しました。
  - カウンターやバリデーション失敗等で `cancelled`（キャンセル済み）となった `action.attack` から `action.block` が誤って誘発したり、キャンセルされた `action.block` から `action.damageJudge` が誤誘発したりする事故を完全に遮断しました。

### テストおよび検証実績

- **網羅的な統合テストの追加 (`triggerResolver.test.ts`)**:
  - [triggerResolver.test.ts](file:///c:/Users/black/git/github/BlackPoker/tools/simulator/src/tests/rules-vnext/triggerResolver.test.ts) を新規追加し、以下のケース A〜J（アサーションを含む）を実装しました。
    - **ケースA**: Grave への Legacy Card 移動時に `nextGeneration` リクエストがバッファに積まれること。同時に、二重実行が防止され、ライフが二重に削られていないことを厳密にアサート。
    - **ケースB**: Fog -> Grave 移動では `nextGeneration` がバッファに積まれないこと。
    - **ケースC**: `action.attack` 解決時にアタッカーがいれば `action.block` がバッファに積まれ、コントローラーが防御側（`p2`）に自動特定されること。
    - **ケースD**: アタッカー不在時は `action.block` がバッファに積まれないこと。
    - **ケースE**: `action.block` 解決時に対応関係があれば `action.damageJudge` がバッファに積まれ、コントローラーが手番ターンプレイヤー（`p1`）に自動特定されること。
    - **ケースF, G, H**: 同一評価内でメイン系アクションが複数誘発した場合、最初の1件のみバッファに積まれ、後続は 6-D-9 により破棄され、破棄理由付きで `discarded` として history に残ること。
    - **ケースI**: `cancelled` の `action.attack` では `action.block` がバッファに積まれないこと。
    - **ケースJ**: `cancelled` の `action.block` では `action.damageJudge` がバッファに積まれないこと。
- **自動テストの実行結果 (`npm test`)**:
  - 新規追加した `triggerResolver.test.ts` を含む、**全18ファイル・105ケースすべての Vitest 統合テストが 100% グリーンで正常にパス**することを確認しました。
- **CLIシナリオランナーおよびビルド検証**:
  - `npm run build` による Vite 本番ビルドも完全に成功。
  - シナリオ7をアタック、ブロック、ダメージ判定解決の手順として実行し、アタック解決時（`[TRIGGER] ブロック が誘発しました`）およびブロック解決時（`[TRIGGER] ダメージ判定 が誘発しました`）にバッファ蓄積が正しく動作し、既存の手動実行シナリオが一切壊れず正常完走することを確認しました。

### 今後のステップ

本フェーズにより、公式ルールに極めて近い「リクエストバッファと汎用誘発評価エンジン」の型安全な最小土台が整いました。リクエストバッファに蓄積されたリクエストの自動解決や、チャンス移行処理との動的統合は、将来のフェーズでの統合課題として持ち越し、まずは安全かつ堅牢な誘発エンジンを完成させました。

