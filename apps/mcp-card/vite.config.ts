import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL("src/main.ts", import.meta.url)),
      name: "VideoResultCard",
      formats: ["iife"],
      fileName: () => "card.js",
    },
  },
});
