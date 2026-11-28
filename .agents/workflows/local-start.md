---
description: worktreeごとにDockerで公式ルールのローカルプレビューを起動する
---

# ドキュメントローカル起動ワークフロー (/local-start)

対象worktreeのルートをPowerShell 7で開き、起動します。

```powershell
./tools/dev/start-rule-preview.ps1
```

起動には文書ビルド用のDockerイメージが必要です。既存の `blackpoker-doc:latest` を使うか、[環境設定](../../dev-notes/dev-setting.md) の手順で準備したイメージを `-Image` で指定します。

スクリプトが表示したURLをブラウザで開きます。初回はSphinxのビルドが終わるまで待ちます。RSTや図の変更を保存すると、再ビルドとブラウザの再読み込みが行われます。ログの確認や停止には、起動時に表示されたコンテナID付きのコマンドを使います。

アクション一覧やフレーム表を確認する場合は、初回と定義YAMLの変更後に、[Dockerビルド検証手順](docker-build.md) のMavenコマンドを対象worktreeで実行して生成データを更新します。
