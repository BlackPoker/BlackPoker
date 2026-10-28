---
description: Docker経由でsphinx-autobuildを起動し、ファイルの変更検知・ホットリロード付きでローカル閲覧可能にする
---

# ドキュメントローカル起動ワークフロー (/local-start)

プロジェクトルートで実行してください。
Docker経由で **sphinx-autobuild** を起動し、ソースファイル（`.rst` や `.puml` など）の編集・保存時に自動で再ビルドとブラウザのホットリロード（自動更新）を行います。

## 1. ローカルWebサーバーの起動（sphinx-autobuild）

Docker経由で `sphinx-autobuild` をポート `8000` でバックグラウンド起動します。

```bash
docker run --rm -d --name bp-docs-server -p 8000:8000 --user root -v "${PWD}:/work" -w /work blackpoker-doc:latest sphinx-autobuild --host 0.0.0.0 --port 8000 ./source ./build/_html
```

起動後、ブラウザで次のURLにアクセスしてください：
* トップページ: http://localhost:8000/
* コアルール: http://localhost:8000/core/core.html

※ファイル保存時に自動で差分検知・再ビルドが行われ、ブラウザ表示がリアルタイムに更新されます。

## 2. ログ確認

自動ビルドの状態やログを確認したい場合は次のコマンドを実行します。

```bash
docker logs -f bp-docs-server
```

## 3. サーバーの停止

閲覧・作業が終了し、サーバーを停止する場合は次のコマンドを実行します。

```bash
docker stop bp-docs-server
```
