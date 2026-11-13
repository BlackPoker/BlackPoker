# Git Commit Message Rules
TARGET_LANGUAGE: Japanese
COMMIT_MESSAGE_LANGUAGE: Japanese

Gitのコミットメッセージを生成する際（「Generate Commit Message」機能やボタンを使用する場合を含む）は、**常に日本語**で記述してください。

フォーマット: <type>: <日本語での説明>

# Artifact Rules
実装計画 (implementation_plan.md) やタスクリスト (task.md) などのアーティファクトは、常に**日本語**で記述してください。

# 共通の開発規約
- `act.yaml` / `act-frame.yaml` などの `update` を追加・更新するときは、`devNote` に変更内容・理由も記載してください。
- CSV/RSTの表内で未設定・該当なしを示すハイフンは `\-` とエスケープしてください。
- RSTの日本語見出しのアンダーラインは表示幅より十分長くしてください。
- 文書編集時は `.agents/skills/rst_style_guide/SKILL.md` と既存の文書検証手順を参照してください。

# Issue起点の開発（Codex / Antigravity 共通）
- 対象は `BlackPoker/BlackPoker` です。Issueは常にリポジトリ名と番号の組で記録します。
- 作業を開始する前に `dev-notes/ai-dlc.md` を読み、対象worktree・基点ブランチとSHA・作業ブランチ・Issueを確認してください。
- 短い依頼の入口はCodexの `$bp-task` とAntigravityの `/bp-task` です。入力の扱い・承認範囲・再開判断は `dev-notes/ai-dlc.md` に集約し、入口ごとに複製しません。
- 既存worktreeは別作業で使用中です。編集・checkout・stash・reset・削除・既存コンテナの停止をしないでください。新しいIssueは専用worktreeで扱います。
- ブランチ名やデフォルトブランチを推測しないでください。明示された基点を優先し、未指定ならローカルの `gh` CLIで現在のデフォルトブランチを取得してください。
- Issueが簡単な記述でも、関連ファイルを調べ、受入条件・変更範囲・必要な検証を整理できます。判断が必要な不明点のみ質問し、実装計画の承認後に編集します。
- Codex / AntigravityからIssueを起票するときは、作成時点の `.github/ISSUE_TEMPLATE/` から適切なテンプレートを読み、見出しと項目を保った日本語の本文案を作成します。タイトル規則・ラベル・担当指定も確認し、起票指示の範囲で `gh issue create` を実行します。
- GitHubに直接作成された既存Issueはそのまま入力として扱い、テンプレートへの書き直しやIssue本文の更新を必須にしません。
- PRも作成時点の `.github/PULL_REQUEST_TEMPLATE.md` を読み、全見出しを維持した日本語の本文にします。該当しない項目は「無し」と書きます。
- GitHub操作はローカルの `gh` CLI、Git転送は `git` を使用します。Copilotには依存しません。

# 検証・確認サイト・公開
- ルール文書だけの修正でSimulator検証を一律必須にしないでください。文体確認・必要な生成確認・ブランチ別確認サイトの目視確認を中心に、変更内容に応じた検証を計画します。
- Simulator本体や連携部分を変更した場合は該当テスト・ビルド、Tutorialを変更した場合は該当テスト・教材検証・ビルドを実施します。公式定義変更の影響は調査し、追加検証が必要な場合だけ計画に含めます。
- 検証記録には対象SHA、未コミット差分の有無、コマンド、結果、未実施理由を含めます。失敗・未実施を成功扱いしません。
- 確認サイト用pushの前に差分と検証結果を提示します。承認された対象ブランチだけをpushし、既存 `refresh_docs` の手動実行と公開反映を確認します。承認は対象と範囲を記録し、同じ範囲で再確認を繰り返しません。
- ブランチ別サイトのURL・生成元SHA・実行結果を提示し、表示を目視確認します。ユーザーの確認待ちとAI自身が確認した結果を区別してください。
- サイト確認後にPR本文案を提示し、指示を受けてDraft PRを作成します。確認用pushの承認をPR作成の承認と解釈しません。
- 既存の公開用Actions、Simulator/Tutorialの開発環境は維持します。CIの既存障害は分けて報告し、この作業に便乗して修正しません。
