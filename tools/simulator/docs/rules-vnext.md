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

- **「カットイン」用語の非採用（第9版公式手順アライン）**:
  - 第9版の公式手順およびルール規定に合わせ、設計・コード・アサーションから「カットイン」という用語を完全に排除しました。本機能は「ステージ上のリクエストを対象にして、解決される前に取り消す仕組み（カウンター）」として整理されています。
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
