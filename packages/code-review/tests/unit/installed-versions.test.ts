import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { collectInstalledVersions } from "../../src/agents/reviewer/installed-versions.ts";

describe("collectInstalledVersions", () => {
  it("returns nothing when the directory has no package.json", async () => {
    await expect(collectInstalledVersions(await mkdtemp(join(tmpdir(), "cr-none-")))).resolves.toEqual([]);
  });

  it("drops dependencies that cannot be resolved instead of throwing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cr-unresolvable-"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: { "not-installed": "^1.0.0" } }));

    await expect(collectInstalledVersions(cwd)).resolves.toEqual([]);
  });

  it("reads name@version for dependencies that are installed", async () => {
    const versions = await collectInstalledVersions(process.cwd());

    expect(versions).toContainEqual(expect.stringMatching(/^zod@\d+\./));
  });
});
