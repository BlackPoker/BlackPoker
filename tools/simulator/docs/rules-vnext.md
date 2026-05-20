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
