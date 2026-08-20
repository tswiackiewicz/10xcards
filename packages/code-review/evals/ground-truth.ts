/**
 * Precondition for the one planted flaw that depends on the host repo.
 *
 * `flaw_defaultprops` is only judgeable if the prompt's "Installed versions (ground truth)"
 * block carries React 19 — the system prompt forbids the model from asserting anything about
 * versions absent from that block. That block is built from the **root** manifest, so dropping
 * react from the root app (or extracting this package) would silently score every model 0 on
 * the sweep's only real discriminator, reading as three model failures rather than one harness
 * failure. Checking it costs one file read and turns that silent zero into a named error.
 *
 * Resolution order mirrors `collectInstalledVersions`: installed manifest first, lockfile as
 * the fallback. That function stays internal to the package by design, so this is a deliberate
 * narrow re-read of the same two files rather than an import.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** The react version the ground-truth block will carry, or null if it will carry none. */
export async function resolveReactVersion(cwd: string): Promise<string | null> {
  const installed = await readJson(path.join(cwd, "node_modules", "react", "package.json"));
  if (installed !== null && typeof installed === "object" && "version" in installed) {
    const { version } = installed as { version?: unknown };
    if (typeof version === "string") {
      return version;
    }
  }

  const lockfile = await readJson(path.join(cwd, "package-lock.json"));
  if (lockfile !== null && typeof lockfile === "object" && "packages" in lockfile) {
    const { packages } = lockfile as { packages?: Record<string, { version?: unknown }> };
    const version = packages?.["node_modules/react"]?.version;
    if (typeof version === "string") {
      return version;
    }
  }

  return null;
}

/** Null when the precondition holds; otherwise the message to fail loudly with. */
export async function checkGroundTruth(cwd: string): Promise<string | null> {
  const version = await resolveReactVersion(cwd);
  if (version === null) {
    return `HARNESS ERROR: no react entry resolvable under ${cwd} — the ground-truth versions block will omit React, which makes flaw_defaultprops unjudgeable and scores every model 0 on it`;
  }

  const major = Number.parseInt(version, 10);
  if (Number.isNaN(major) || major < 19) {
    return `HARNESS ERROR: ground truth resolves react@${version} under ${cwd}, but flaw_defaultprops assumes React >= 19 — the fixture and the rubric are stale relative to the host repo`;
  }

  return null;
}
