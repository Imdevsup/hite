import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // `.scratch` is local scratch work — untracked, gitignored, eslint-ignored. A probe file left in
    // there must not join the suite; all three ignore lists have to agree or one of them fails a gate.
    exclude: ["node_modules", ".next", "sandbox", ".scratch"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `next/font/google` only exists inside the Next build; the landing loads its faces through
      // it, and the SSR gates render the landing. See test/stubs/next-font-google.ts.
      "next/font/google": path.resolve(__dirname, "test/stubs/next-font-google.ts"),
    },
  },
});
