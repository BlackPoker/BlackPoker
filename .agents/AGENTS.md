# Git Commit Message Rules
TARGET_LANGUAGE: Japanese
COMMIT_MESSAGE_LANGUAGE: Japanese

Gitのコミットメッセージを生成する際（「Generate Commit Message」機能やボタンを使用する場合を含む）は、**常に日本語**で記述してください。

フォーマット: <type>: <日本語での説明>

# Artifact Rules
実装計画 (implementation_plan.md) やタスクリスト (task.md) などのアーティファクトは、常に**日本語**で記述してください。

# Action List / YAML Update Rules
`act.yaml` や `act-frame.yaml` などのアクション定義 YAML において `update` フィールドを追加・更新する際は、必ず `devNote` にも更新理由や変更内容の説明を記載してください。

# Table Escaping Rules (CSV / RST)
CSVやRSTの表内で未設定・該当なし等を意味するハイフン (`-`) を記述する際は、RSTパーサーによって箇条書き記号（`●`）として誤認識・変換されるのを防ぐため、必ずエスケープして `\-` と記述してください。

# RST Title Underline Rules
RSTの日本語見出し（タイトル）におけるアンダーライン記号（`=`, `-`, `~`, `^` など）は、全角文字や装飾（バックティック等）による文字幅計算の誤差で `Title underline too short` 警告が出るのを防ぐため、タイトルの表示幅よりも**意識して十分長め（多め）**に記号を設定してください。


