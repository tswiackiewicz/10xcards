import { defineConfig } from "vitest/config";

// Tests live next to the sources they cover, under src/ — that is what keeps them
// inside tsconfig's `include` and ESLint's type-aware `files` block. Vitest 4's
// default include is tests/**, so it has to be pointed at src/ explicitly.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
