import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

export const repositoryRoot = resolve(scriptDirectory, "..", "..");

export function fail(message, details = []) {
  const lines = [message, ...details.map((detail) => `  - ${detail}`)];
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exitCode = 1;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });

  if (result.error) throw result.error;
  return result;
}

export function trackedFiles() {
  const result = run("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
  }
  return result.stdout.split("\0").filter(Boolean);
}

export function toPosix(path) {
  return path.replaceAll("\\", "/");
}
