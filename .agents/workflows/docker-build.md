---
description: Docker経由でMavenビルド（actionlist RST生成）とSphinx HTMLビルドを実行する
---

# Docker ビルド検証ワークフロー

プロジェクトルートで実行すること。

## 1. actionlist RST生成（Maven）

プロジェクトルートで実行すること。
`tools/actionlist/pom.xml` の出力パスが `../../source/auto/` を使うため、プロジェクト全体をマウントする必要がある。

// turbo
```
docker run --rm -v "${PWD}:/project" -w /project/tools/actionlist maven:3.6.2-jdk-11 mvn clean install -DskipTests -q
```

生成結果は `source/auto/` 配下に出力される:
- `source/auto/actionlist.rst` — 標準アクションリスト
- `source/auto/frameActionlist.rst` — フレームアクションリスト
- `source/auto/framelist.rst` — フレームリスト
- `source/auto/frame-format.csv` — フレームフォーマットCSV

### 生成結果の確認

// turbo
```
Get-Content source/auto/frameActionlist.rst -Head 80
```

## 2. Sphinx HTMLビルド

// turbo
```
docker run --rm -v "${PWD}:/work" -w /work python:3.9-slim bash -c "pip install -q -r requirements.txt && sphinx-build -q -b html ./source ./build/_html"
```

全ビルド（HTML）の結果は `build/_html/` に出力される。
