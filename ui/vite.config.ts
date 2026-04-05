import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

const apiTarget = process.env.VITE_API_TARGET || "http://localhost:8080";

export default defineConfig({
  plugins: [preact()],
  base: "./",
  build: {
    outDir: "../serve/static",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
