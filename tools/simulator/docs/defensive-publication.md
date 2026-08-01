# BlackPoker Simulator Defensive Publication

## 公開目的

この文書は、BlackPoker のルール検証・盤面再現・バランス調整を行うための
シミュレーションツール構想を公開するものです。

## 公開するアイデア

- BlackPoker の盤面を Web 上に再現する
- 領域、ユニット、アクション、リクエスト、ステージをデータ構造として扱う
- コマンド入力により盤面を操作する
- 操作ログを残し、対戦状況を再現可能にする
- act.yaml / act-frame.yaml などのルール定義を読み込み、アクション辞書として利用する
- 将来的にコマンドログを再生し、ルール検証やバランス調整に利用する
- 将来的にルールエンジンを TypeScript から Rust / WebAssembly に分離可能にする

## 想定構成

- UI: React + TypeScript
- ルールモデル: TypeScript domain model
- コマンド処理: command parser / command runner
- データ: BlackPoker 公式ルール定義 YAML
- 将来的な拡張: Rust / WebAssembly によるルールエンジン分離

## 非目的

現時点では以下を目的としない。

- オンライン対戦
- AI対戦
- 完全自動裁定
- ユーザー認証
- データベース連携
