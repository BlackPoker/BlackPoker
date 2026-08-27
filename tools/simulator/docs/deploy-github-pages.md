# GitHub Pages / 静的ホスティング配備ガイド

BlackPoker シミュレータ / Core Battle Playtest は、サーバーサイドの実行環境を必要とせず、クライアントサイド（ブラウザ内）の TypeScript / Vite 環境のみで完全動作するように設計されています。

公式ルール HTML / PDF / ActionList と同様に、既存の `.github/workflows/refresh_docs.yaml` パイプライン内で一括ビルドされ、`gh-pages` ブランチの各 revision 配下に配置されます。

---

## 1. 静的ビルドとアーキテクチャ

- **Rule Loader**: `BrowserRuleLoader.ts` が Vite の `import.meta.glob` を使用して YAML 定義（`src/data/rules-vnext/**/*.yaml`）を直接バンドル。
- **Game Engine**: `GameSession`, `CoreFlowCoordinator`, `LegalPatternGenerator` などのコアエンジンはすべて純粋な JavaScript/TypeScript で動作。
- **UI**: React + Tailwind CSS によるシングルページアプリケーション（SPA）。

---

## 2. 公開 URL 構造 (Branch-specific subpath)

Simulator は各ブランチ・リビジョンの公式ドキュメント群のサブパス `/playtest/` 配下に公開されます。

### (1) master ブランチ (canonical)
- **公式ルール**: `https://blackpoker.github.io/BlackPoker/master/`
- **ActionList Web**: `https://blackpoker.github.io/BlackPoker/master/actionlist/html/`
- **Playtest Simulator**: `https://blackpoker.github.io/BlackPoker/master/playtest/`

> ※ 毎日 AM 4:00 (JST) の cron スケジュールまたは手動 `workflow_dispatch` により、同一リビジョンから一括生成されます。

### (2) 開発ブランチ (Playtest 検証)
- **Playtest Simulator**: `https://blackpoker.github.io/BlackPoker/<branch-name>/playtest/`
  - 例: `https://blackpoker.github.io/BlackPoker/BlackPoker/issue551-core-flow/playtest/`

> ※ GitHub Actions の「Actions」タブ $\rightarrow$ 「refresh_docs」 $\rightarrow$ 「Run workflow」で対象ブランチを選択して手動実行することで即座に配備されます。

---

## 3. CI/CD ワークフロー (`.github/workflows/refresh_docs.yaml`)

Simulator は独立したデプロイワークフローを持たず、既存の `refresh_docs.yaml` 内で以下のステップとして実行されます：

1. **セットアップ**: Node.js 20 をセットアップし `npm ci` を実行。
2. **自動検証**: `npm test` および `npm run playable:check` でコアフロー完走を確認。
3. **バンドル生成**: `VITE_BASE_PATH=/BlackPoker/${short_ref}/playtest/`、`VITE_BUILD_SHA`、`VITE_BUILD_REF` を付与して `npm run build`。
4. **Docs 統合**: `tools/simulator/dist/*` を `main/docs/playtest/` へコピー。
5. **gh-pages 反映**: 既存の Sphinx HTML / PDF / ActionList とともに `gh-pages/${short_ref}/` へ 1 回のコミット＆プッシュで公開。

