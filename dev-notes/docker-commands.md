# Dockerコマンド実行手順

このドキュメントでは、本プロジェクトにおけるドキュメントビルドや自動生成などをDocker経由で実行するためのコマンドをまとめています。
すべてプロジェクトルート（`BlackPoker`のルートディレクトリ）で実行することを想定しています。

---

## 1. アクションリスト自動生成 (Mavenビルド)

YAMLの定義ファイルからアクションリスト（RSTファイルなど）を自動生成するコマンドです。
`tools/actionlist` 内のMavenプロジェクトを実行し、`source/auto/` 配下に成果物を出力します。

**実行コマンド (PowerShell / bash 共通):**
```bash
docker run --rm -v "${PWD}:/project" -w /project/tools/actionlist maven:3.6.2-jdk-11 mvn clean install -DskipTests -q
```

**生成される主なファイル:**
* `source/auto/actionlist.rst`
* `source/auto/frameActionlist.rst`
* `source/auto/framelist.rst`
* `source/auto/frame-format.csv`

---

## 2. Sphinx 自動ビルド & プレビュー (sphinx-autobuild)

ローカルのRSTファイルの変更を検知して自動ビルドし、ホストのブラウザでプレビューするためのコマンドです。
コンテナのポート `8000` をホストにマッピングします。

**実行コマンド (PowerShell / bash 共通):**
```bash
docker run --rm -it -v "${PWD}:/work" -w /work -p 8000:8000 python:3.9-slim bash -c "pip install -r requirements.txt && sphinx-autobuild --host 0.0.0.0 --port 8000 source build/_html"
```
起動後、ブラウザで [http://localhost:8000](http://localhost:8000) にアクセスすることで、リアルタイムにプレビューを確認できます。

---

## 3. アクションリスト自動生成 ＋ HTML・PDFの一括ビルド

アクションリストの自動生成（Maven）から、SphinxによるHTML生成、およびLaTeX経由でのPDF（中綴じ冊子レイアウト等）生成までを一気に行う手順です。

WindowsのPowerShellで一括実行する場合、以下のコマンドシーケンスを実行します。

**一括実行コマンド (PowerShell用):**
```powershell
# 1. アクションリスト自動生成
docker run --rm -v "${PWD}:/project" -w /project/tools/actionlist maven:3.6.2-jdk-11 mvn clean install -DskipTests -q

# 2. ドキュメントビルド用Dockerイメージの構築
docker build --pull --rm -f "Dockerfile" -t blackpoker-doc:latest .

# 3. ビルド実行（HTMLおよびPDFが docs/ ディレクトリに出力されます）
docker run --rm -it -v "${PWD}/docs:/docs" blackpoker-doc:latest
```

**一括実行コマンド (bash用):**
```bash
# 1. アクションリスト自動生成
docker run --rm -v "${PWD}:/project" -w /project/tools/actionlist maven:3.6.2-jdk-11 mvn clean install -DskipTests -q

# 2. ドキュメントビルド用Dockerイメージの構築
docker build --pull --rm -f "Dockerfile" -t blackpoker-doc:latest .

# 3. ビルド実行
docker run --rm -it -v "$(pwd)/docs:/docs" blackpoker-doc:latest
```

**出力成果物:**
* `docs/` 配下にHTMLファイル群
* `docs/blackpoker.pdf` (LaTeXビルドPDF)
* `docs/blackpoker_a5.pdf` (A5縮小PDF)
* `docs/blackpoker_a5-booklet.pdf` (中綴じ冊子用PDF)
