import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { collectInstalledVersions } from "../../src/agents/reviewer/installed-versions.ts";

/** A project directory with a manifest and, optionally, a lockfile and installed packages. */
async function project({
  dependencies,
  lockfile,
  installed = {},
}: {
  dependencies: Record<string, string>;
  lockfile?: string;
  installed?: Record<string, string>;
}) {
  const cwd = await mkdtemp(join(tmpdir(), "cr-"));
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies }));

  if (lockfile !== undefined) {
    await writeFile(join(cwd, "package-lock.json"), lockfile);
  }

  for (const [name, version] of Object.entries(installed)) {
    await mkdir(join(cwd, "node_modules", name), { recursive: true });
    await writeFile(join(cwd, "node_modules", name, "package.json"), JSON.stringify({ version }));
  }

  return cwd;
}

const lockfileFor = (versions: Record<string, string>) =>
  JSON.stringify({
    lockfileVersion: 3,
    packages: Object.fromEntries(
      Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, { version }]),
    ),
  });

describe("collectInstalledVersions", () => {
  it("returns nothing when the directory has no package.json", async () => {
    await expect(collectInstalledVersions(await mkdtemp(join(tmpdir(), "cr-none-")))).resolves.toEqual([]);
  });

  it("drops dependencies that cannot be resolved instead of throwing", async () => {
    const cwd = await project({ dependencies: { "not-installed": "^1.0.0" } });

    await expect(collectInstalledVersions(cwd)).resolves.toEqual([]);
  });

  it("reads name@version for dependencies that are installed", async () => {
    const versions = await collectInstalledVersions(process.cwd());

    expect(versions).toContainEqual(expect.stringMatching(/^zod@\d+\./));
  });

  it("falls back to the lockfile when node_modules is absent", async () => {
    const cwd = await project({
      dependencies: { astro: "^6.0.0", zod: "^4.0.0" },
      lockfile: lockfileFor({ astro: "6.1.2", zod: "4.4.3" }),
    });

    await expect(collectInstalledVersions(cwd)).resolves.toEqual(["astro@6.1.2", "zod@4.4.3"]);
  });

  it("prefers an installed package over the lockfile entry", async () => {
    const cwd = await project({
      dependencies: { zod: "^4.0.0" },
      lockfile: lockfileFor({ zod: "4.0.0" }),
      installed: { zod: "4.4.3" },
    });

    await expect(collectInstalledVersions(cwd)).resolves.toEqual(["zod@4.4.3"]);
  });

  it("drops a dependency missing from both node_modules and the lockfile", async () => {
    const cwd = await project({
      dependencies: { astro: "^6.0.0", ghost: "^1.0.0" },
      lockfile: lockfileFor({ astro: "6.1.2" }),
    });

    await expect(collectInstalledVersions(cwd)).resolves.toEqual(["astro@6.1.2"]);
  });

  it("degrades to an empty list on a malformed lockfile rather than throwing", async () => {
    const cwd = await project({ dependencies: { zod: "^4.0.0" }, lockfile: "{ not json" });

    await expect(collectInstalledVersions(cwd)).resolves.toEqual([]);
  });
});
