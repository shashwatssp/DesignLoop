import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // @excalidraw/excalidraw checks this flag; we ship the React build.
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  optimizeDeps: {
    esbuildOptions: {
      // Required by Excalidraw ("Arbitrary module namespace identifier names")
      target: "es2022",
    },
  },
  build: {
    target: "es2022",
    // Excalidraw is a large dependency; silence the chunk size warning.
    chunkSizeWarningLimit: 4000,
  },
});
