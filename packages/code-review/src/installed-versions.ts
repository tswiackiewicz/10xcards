import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Installed versions of direct dependencies, so the model never has to guess them.
 *
 * The only filesystem I/O in the package. Every read resolves under the passed `cwd`
 * and is limited to manifest files — `package.json` and `node_modules/<name>/package.json`.
 * Keep it that way: this is the seam a model-driven tool would attach to, and nothing
 * here should ever take a path from model output.
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
  const rows = await Promise.all(
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

  return rows.filter((row) => row !== null);
}
