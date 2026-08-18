import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Installed versions of direct dependencies, so the model never has to guess them.
 *
 * The only filesystem I/O in the package. Every read resolves under the passed `cwd`
 * and is limited to manifest files — `package.json`, `node_modules/<name>/package.json`
 * and `package-lock.json`. Keep it that way: this is the seam a model-driven tool would
 * attach to, and nothing here should ever take a path from model output.
 *
 * Read failures are swallowed by design: a missing manifest or an unresolvable
 * dependency must degrade the prompt, never fail the review.
 */
export async function collectInstalledVersions(cwd: string): Promise<string[]> {
  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as typeof manifest;
  } catch {
    return [];
  }

  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const installed = await Promise.all(
    names.map(async (name) => {
      try {
        const pkg = JSON.parse(await readFile(join(cwd, "node_modules", name, "package.json"), "utf8")) as {
          version: string;
        };
        return `${name}@${pkg.version}`;
      } catch {
        return null;
      }
    }),
  );

  // CI installs only packages/code-review, so pointing `cwd` at the repo root makes
  // every node_modules read miss and the ground-truth block silently go empty — which
  // re-opens the version-hallucination problem the prompt guardrail exists to close.
  // The lockfile is the same repo's manifest, read once per call, not once per dependency.
  const missing = names.filter((_name, index) => installed[index] === null);
  const locked = missing.length > 0 ? await readLockedVersions(cwd) : new Map<string, string>();

  return names
    .map((name, index) => {
      const resolved = installed[index];
      if (resolved !== null && resolved !== undefined) {
        return resolved;
      }
      const version = locked.get(name);
      return version === undefined ? null : `${name}@${version}`;
    })
    .filter((row) => row !== null);
}

/** `packages["node_modules/<name>"].version`, the lockfileVersion 3 layout. */
async function readLockedVersions(cwd: string): Promise<Map<string, string>> {
  try {
    const lockfile = JSON.parse(await readFile(join(cwd, "package-lock.json"), "utf8")) as {
      packages?: Record<string, { version?: string }>;
    };

    return new Map(
      Object.entries(lockfile.packages ?? {}).flatMap(([path, entry]) => {
        const name = path.startsWith("node_modules/") ? path.slice("node_modules/".length) : null;
        return name === null || entry.version === undefined ? [] : [[name, entry.version] as const];
      }),
    );
  } catch {
    return new Map();
  }
}
