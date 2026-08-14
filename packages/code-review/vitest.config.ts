import { defineConfig } from "vitest/config";

// This file must exist even though it sets nothing: without a local config vitest
// walks up and picks up the repo-root vitest.config.ts, whose globalSetup
// ("tests/setup/env.ts") and Astro stubs do not exist here — the run dies with
// ERR_LOAD_URL. This package is standalone (see AGENTS.md), so it shadows the root
// config deliberately.
//
// The test layout — tests/{unit,integration}/ — matches the root project and vitest's
// own default include, so no include override is needed.
export default defineConfig({});
