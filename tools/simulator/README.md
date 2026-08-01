# BlackPoker Simulator

Experimental / Prototype

このツールは BlackPoker の開発中の検証用ツールです。

現時点では公式の対戦ツールではありません。
ルール処理は完全ではありません。
表示、コマンド仕様、データ構造は予告なく変更される可能性があります。

## Development

```bash
docker compose up
```

### 主要検証コマンド

```bash
# 統合テスト (Vitest)
docker compose run --rm app npm test

# 本番ビルドおよび型チェック
docker compose run --rm app npm run build

# 新旧アクション定義の比較レポート再生成
docker compose run --rm app npm run compare:rules-vnext

# 新YAML DSL挙動確認CLIシナリオ実行
docker compose run --rm app npm run scenario:rules-vnext
```

Open:

```text
http://localhost:5173/
```

## 非目標

初期段階では以下はやらないでください。

- オンライン対戦
- AI対戦
- 完全な自動裁定
- ユーザー認証
- DB保存
- GitHub Pages公開
- 既存公式ルールサイトへのリンク追加
- 既存Actionsの変更

## 最終的な方向性

最終的には、BlackPoker の公式ルール・アクション定義 YAML と連携し、以下ができるツールに育てたいです。

- 盤面再現
- コマンドログ保存
- コマンドログ再生
- 裁定確認
- ルール検証
- バランス調整
- シナリオテスト
- 将来的な GitHub Pages 公開

ただし、今はまず `tools/simulator/` 配下で、壊れにくい最小構成のプロトタイプを作ってください。
