# BlackPoker Simulator Agent Rules

## Technology Stack & Language Rules (Python禁止)
- BlackPoker Simulator (`tools/simulator/`) の開発、実装、テスト、補助スクリプト、検証ロジック、データ変換等において、**Python（`python`, `python3`, `pip`, `venv`, `pytest`, `*.py` ファイル等）は一切使用・導入・作成しないでください**。
- すべての実装ロジックおよび検証は **TypeScript / Node.js**（および Docker, npm, npx, shell command）へ統一してください。
- 「一時的な確認用」であっても Python スクリプトの作成や実行は禁止します。

## Commit Message Rules
- コミットメッセージは常に日本語で記述してください。
- フォーマット: `<type>: <日本語での説明>`

## Artifact Rules
- 実装計画 (implementation_plan.md) やタスクリスト (task.md) などのアーティファクトは、常に日本語で記述してください。

## Docker Operation and Task Management Rules
ルートの `AGENTS.md` に定められた以下の規則を厳格に遵守してください：
- **Docker Desktopの操作ルール**: `com.docker.backend.exe` 等の内部プロセス直接操作、`taskkill`/`Stop-Process`、`wsl --shutdown` を禁止。起動・再起動・停止はユーザーが行う。
- **Docker障害発生時の手順**: `docker info` 確認、短時間の再試行（上限設定）、復旧しない場合は作業中断してユーザーへ報告。自律的な復旧試行や無期限リトライの禁止。
- **タスクの実行管理ルール**: 常駐プロセスと終了コマンドの明確な区別、適切なタイムアウト設定、タイムアウト時の原因調査、作業完了時の不要タスク残存確認、GitHub Actions成功後のローカル全体テスト無用反復の禁止。

