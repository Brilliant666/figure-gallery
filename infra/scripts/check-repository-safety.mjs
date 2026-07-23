import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { fail, repositoryRoot, toPosix, trackedFiles } from "./lib.mjs";

const files = trackedFiles();
const errors = [];
const maximumTrackedBytes = 1024 * 1024;
const allowedEnvironmentFiles = new Set([
  "apps/web/.env.example",
  "infra/compose/.env.example",
]);
const forbiddenExtensions = new Set([
  ".7z",
  ".avi",
  ".backup",
  ".bak",
  ".bin",
  ".bmp",
  ".bz2",
  ".db",
  ".dll",
  ".dump",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".iso",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp4",
  ".msi",
  ".node",
  ".pdf",
  ".pgdump",
  ".png",
  ".psd",
  ".rar",
  ".so",
  ".sqlite",
  ".sqlite3",
  ".sql",
  ".tar",
  ".tgz",
  ".tif",
  ".tiff",
  ".webp",
  ".xz",
  ".zip",
]);
const generatedSegments = [
  "/.next/",
  "/node_modules/",
  "/coverage/",
  "/dist/",
  "/build/",
  "/out/",
  "/playwright-report/",
  "/test-results/",
  "/blob-report/",
  "/postgres-data/",
  "/minio-data/",
  "/object-storage/",
  "/local-media/",
];

const contentRoots = [
  "apps/",
  "packages/",
  "infra/",
  "docs/",
  ".github/",
  "research/evidence/pr00/",
  "research/evidence/pr01/",
  "research/evidence/security-2026-07/",
];
const textExtensions = new Set([
  "",
  ".cjs",
  ".css",
  ".env",
  ".example",
  ".gitignore",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".scss",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const secretPatterns = [
  {
    name: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  { name: "GitHub token", pattern: /gh[opusr]_[A-Za-z0-9]{20,}/ },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  {
    name: "JWT",
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: "literal credential assignment",
    pattern:
      /(?:PASSWORD|SECRET|TOKEN|ACCESS_KEY(?:_ID)?)["']?\s*[:=]\s*["'](?![^"'\r\n]*(?:\$\{|\$\(|process\.env|replace-with|synthetic|test-|example|placeholder))[^"'\r\n]{12,}["']/i,
  },
];

for (const rawPath of files) {
  const path = toPosix(rawPath);
  const absolutePath = join(repositoryRoot, rawPath);
  if (!existsSync(absolutePath)) {
    continue;
  }
  const stat = statSync(absolutePath);

  if (stat.size > maximumTrackedBytes) {
    errors.push(
      `${path}: tracked file is ${stat.size} bytes (limit ${maximumTrackedBytes})`,
    );
  }

  const lowerPath = path.toLowerCase();
  const extension = extname(lowerPath);
  if (forbiddenExtensions.has(extension)) {
    errors.push(
      `${path}: database, backup, archive, media, or binary extension is forbidden`,
    );
  }
  if (generatedSegments.some((segment) => `/${lowerPath}`.includes(segment))) {
    errors.push(`${path}: generated/runtime output is tracked`);
  }
  if (
    (lowerPath.endsWith("/.env") || /\/(?:\.env\.[^/]+)$/.test(lowerPath)) &&
    !lowerPath.endsWith(".env.example") &&
    !allowedEnvironmentFiles.has(path)
  ) {
    errors.push(`${path}: real environment file is tracked`);
  }

  if (path.startsWith("spikes/")) continue;
  if (
    path.startsWith("research/") &&
    !path.startsWith("research/evidence/pr00/") &&
    !path.startsWith("research/evidence/pr01/") &&
    !path.startsWith("research/evidence/security-2026-07/")
  )
    continue;
  if (path.includes("/") && !contentRoots.some((root) => path.startsWith(root)))
    continue;
  if (stat.size > maximumTrackedBytes) continue;

  const bytes = readFileSync(absolutePath);
  if (bytes.includes(0)) {
    errors.push(`${path}: binary NUL byte found in a formal tracked file`);
    continue;
  }
  if (!textExtensions.has(extension)) continue;

  const content = bytes.toString("utf8");
  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(content)) errors.push(`${path}: possible ${name}`);
  }
}

if (errors.length > 0) {
  fail("Repository safety check failed.", errors);
} else {
  process.stdout.write(
    `Repository safety passed for ${files.length} repository paths.\n`,
  );
}
