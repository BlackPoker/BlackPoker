import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Pagesでは VITE_BASE_PATH=/BlackPoker/tutorial/、ローカルでは / を使用する。
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  // Windows上のDocker bind mountでも保存を検知する。
  server: { watch: { usePolling: true, interval: 300 } },
  test: {
    environment: "jsdom",
    setupFiles: "./tests/setup.ts",
    css: true,
  },
});
