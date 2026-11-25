# Git Commit Message Rules
TARGET_LANGUAGE: Japanese
COMMIT_MESSAGE_LANGUAGE: Japanese

Gitのコミットメッセージを生成する際（「Generate Commit Message」機能やボタンを使用する場合を含む）は、**常に日本語**で記述してください。

フォーマット: <type>: <日本語での説明>

# Artifact Rules
実装計画 (implementation_plan.md) やタスクリスト (task.md) などのアーティファクトは、常に**日本語**で記述してください。

# Technology Stack Rules (BlackPoker Simulator)
BlackPoker Simulator (`tools/simulator/`) の実装、テスト、補助スクリプト、検証ロジック、データ変換等において、**Python（`python`, `python3`, `pip`, `venv`, `pytest`, `*.py` ファイル等）は一切使用・導入・作成しないでください**。
すべて **TypeScript / Node.js**（および Docker, npm, npx, shell command）へ統一してください。一時的な確認やスクリプトであっても Python の使用は厳格に禁止します。

# Docker Operation and Task Management Rules

## Docker Desktopの操作ルール
- `com.docker.backend.exe` などのDocker Desktop内部プロセスやサービスをコマンドラインから直接起動・停止・再起動しないこと
- `Stop-Process` や `taskkill` などでDocker関連プロセスを強制終了しないこと
- `wsl --shutdown` などでWSL環境を停止しないこと
- Docker Desktopの起動、再起動、停止はユーザーが行うものとし、AIが独自に操作を試みないこと

## Docker障害発生時の手順
- Dockerコマンドが応答しない、またはエラーが返る場合：
  1. `docker info` で状態を確認する
  2. 復旧していない場合は、一定回数（例：2回）または一定時間（例：1分）待ってから再確認する
  3. それでも復旧しない場合は、作業を中断し、ユーザーにDockerの状態と必要な対応（Docker Desktopの再起動など）を報告して指示を待つこと
  4. AIが自律的にDockerの復旧を試みたり、無期限にリトライを繰り返したりしないこと

## タスクの実行管理ルール
- バックグラウンドで実行するコマンドについて：
  - 常駐型プロセス（開発サーバー、プレビューサーバー等）と、終了が前提のコマンド（ビルド、テスト等）を明確に区別すること
  - 常駐型プロセスの終了を完了条件とするタスクを作成しないこと
  - 各コマンドに適切なタイムアウト（処理内容に応じた現実的な時間）を設定すること
  - コマンドがタイムアウトした場合、安易にタイムアウト時間を延ばして再実行するのではなく、なぜ終了しないのか（常駐プロセスが動いている、入力を待っているなど）を調査すること
  - 作業完了時には不要なバックグラウンドタスクが残存していないか確認すること
  - GitHub Actionsでビルド・テストが成功していることが確認できた後は、ローカルで無用な全体テストの反復を行わないこと


