# GitHub Pages / 静的ホスティング配備ガイド

BlackPoker シミュレータ / Core Battle Playtest は、サーバーサイドの実行環境を必要とせず、クライアントサイド（ブラウザ内）の TypeScript / Vite 環境のみで完全動作するように設計されています。

---

## 1. 静的ビルドの仕組み

- **Rule Loader**: `BrowserRuleLoader.ts` が Vite の `import.meta.glob` を使用して YAML 定義（`src/data/rules-vnext/**/*.yaml`）を直接バンドルします。
- **Game Engine**: `GameSession`, `CoreFlowCoordinator`, `LegalPatternGenerator` などのコアエンジンはすべて純粋な JavaScript/TypeScript で動作します。
- **UI**: React + Tailwind CSS によるシングルページアプリケーション（SPA）です。

---

## 2. ビルドと配備手順

### (1) ローカルでの本番ビルド
```bash
cd tools/simulator
npm run build
```
`tools/simulator/dist/` ディレクトリに HTML / CSS / JS アセットが出力されます。

### (2) Vite の Base パス設定 (`vite.config.ts`)
GitHub Pages のサブディレクトリ（例: `https://<user>.github.io/<repo>/`）へ配備する場合は、`vite.config.ts` で `base` パスを指定します。

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/BlackPoker/' : './',
  plugins: [react()],
});
```

---

## 3. GitHub Actions による自動配備例

リポジトリ直下の `.github/workflows/deploy-playtest.yml` に以下のワークフローを追加することで、`main` または指定ブランチへのプッシュ時に自動的に GitHub Pages へ配備可能です。

```yaml
name: Deploy Playtest to GitHub Pages

on:
  push:
    branches: [ main, BlackPoker/issue551-core-flow ]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: tools/simulator/package-lock.json

      - name: Install dependencies
        working-directory: tools/simulator
        run: npm ci

      - name: Build
        working-directory: tools/simulator
        env:
          GITHUB_PAGES: "true"
        run: npm run build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: tools/simulator/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```
