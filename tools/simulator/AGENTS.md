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
