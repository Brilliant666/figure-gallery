import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "");
const errors = [];
const files = [];
const allowedExtensions = new Set([".json", ".txt"]);
const maximumFileBytes = 256 * 1024;
const maximumTotalBytes = 1024 * 1024;

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else files.push(path);
  }
}

if (!process.argv[2] || !existsSync(root)) {
  process.stderr.write(
    "Usage: node check-ci-summaries.mjs <summary-directory>\n",
  );
  process.exit(2);
}

walk(root);
let totalBytes = 0;
const secretValues = [
  "PAYLOAD_SECRET",
  "DATABASE_URI",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "PR01_ADMIN_PASSWORD",
]
  .map((name) => [name, process.env[name]])
  .filter((entry) => entry[1]);
try {
  const password = new URL(process.env.DATABASE_URI ?? "").password;
  if (password) secretValues.push(["DATABASE_PASSWORD", password]);
} catch {
  // Environment validation owns malformed URI reporting.
}

for (const path of files) {
  const stat = statSync(path);
  totalBytes += stat.size;
  if (!allowedExtensions.has(extname(path).toLowerCase()))
    errors.push(`${path}: unsupported artifact extension`);
  if (stat.size > maximumFileBytes)
    errors.push(`${path}: artifact exceeds ${maximumFileBytes} bytes`);
  const bytes = readFileSync(path);
  if (bytes.includes(0)) errors.push(`${path}: binary NUL byte found`);
  const content = bytes.toString("utf8").replace(/^\uFEFF/, "");
  for (const [name, value] of secretValues) {
    if (content.includes(value))
      errors.push(`${path}: runtime ${name} leaked into CI summary`);
  }
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[opusr]_[A-Za-z0-9]{20,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(
      content,
    )
  ) {
    errors.push(`${path}: credential-like content found`);
  }
  if (extname(path).toLowerCase() === ".json") {
    try {
      JSON.parse(content);
    } catch {
      errors.push(`${path}: JSON summary is not parseable`);
    }
  }
}

if (totalBytes > maximumTotalBytes)
  errors.push(`summary directory exceeds ${maximumTotalBytes} bytes`);
if (files.length === 0) errors.push("summary directory is empty");

if (errors.length > 0) {
  process.stderr.write(
    `CI summary safety failed:\n${errors.map((error) => `  - ${error}`).join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `CI summary safety passed (${files.length} files, ${totalBytes} bytes).\n`,
);
