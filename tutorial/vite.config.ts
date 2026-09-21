import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Pagesでは VITE_BASE_PATH=/BlackPoker/tutorial/、ローカルでは / を使用する。
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/tests/setup.ts",
    css: true,
  },
});
