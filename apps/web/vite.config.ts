import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (id.includes("three") || id.includes("@react-three")) {
            return "rendering";
          }

          if (id.includes("react")) {
            return "react";
          }

          return "vendor";
        }
      }
    }
  },
  resolve: {
    alias: {
      "@out-of-bounds/map": path.resolve(__dirname, "../../packages/map/src/index.ts"),
      "@out-of-bounds/sim": path.resolve(__dirname, "../../packages/sim/src/index.ts")
    }
  },
  server: {
    host: true
  }
});
