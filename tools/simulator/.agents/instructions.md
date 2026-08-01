# BlackPoker Simulator 開発ガイドライン

このドキュメントは、BlackPoker シミュレーター（`tools/simulator/`）の改修および機能追加において、AIエージェントが遵守すべき設計思想と制約を定義したものです。

## 1. プロジェクトの目的
- BlackPoker の盤面再現、ルール検証、バランス調整、およびシナリオテストを行うためのプロトタイプ。
- 防衛公開（Defensive Publication）を兼ねており、設計と実装を公開リポジトリに残すことで特許化リスクを低減する。

## 2. アーキテクチャ方針
- **UI とロジックの分離**: 将来的にルールエンジンを Rust/Wasm 等に置き換えられるよう、UI（`src/ui/`）とドメインモデル・計算ロジック（`src/domain/`, `src/engine/`）を疎結合に保つ。
- **ドメイン駆動**: `src/domain/` で定義されたカード、ユニット、ゾーン、アクションの型を唯一の正解とする。
- **コマンド駆動**: 盤面の変更は基本的にコマンド（`src/engine/command-runner.ts` 相当）を介して行い、ログとして記録・再現可能にする。

## 3. 技術スタックと制約
- **コア**: Vite + React + TypeScript + TailwindCSS。
- **外部ライブラリの制限**: 
    - アイコンライブラリ（`lucide-react` 等）は使用しない。アイコンは文字（記号）または CSS で表現する。
    - 外部依存を増やしすぎないこと。
- **環境**: 全て Docker (`compose.yaml`) 上で動作することを前提とする。

## 4. 既存環境への干渉禁止（最重要）
シミュレーターの開発は `tools/simulator/` 配下で完結させ、以下の既存資産には一切影響を与えないこと。
- リポジトリ直下の `Dockerfile`, `Makefile`, `docs/`, `source/` 等。
- 既存の GitHub Actions 設定。
- GitHub Pages の公開フロー。
- 公式ルール本文へのリンク追加（現段階では行わない）。

## 5. 開発の進め方
- **Phase 1 (現状)**: `App.tsx` にまとまっているプロトタイプを動作させつつ、順次 `domain/`, `engine/`, `ui/` へリファクタリングする。
- **テスト優先**: 重要なルール処理を追加する際は、`src/tests/` 内にテストを追加し、`vitest` で検証する。

## 6. 参照ドキュメント
詳細な設計やロードマップについては、以下のドキュメントを常に参照すること。
- `tools/simulator/docs/handover.md`（背景と詳細仕様）
- `tools/simulator/docs/defensive-publication.md`（防衛公開の趣旨）
- `tools/simulator/docs/roadmap.md`（今後の予定）
