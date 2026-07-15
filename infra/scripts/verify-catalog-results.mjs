import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const argumentsMap = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf("=");
    return separator === -1
      ? [argument, true]
      : [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);
const markersDirectory = resolve(String(argumentsMap["--markers"] ?? ""));
const outputPath = resolve(String(argumentsMap["--output"] ?? ""));
const ids = Array.from(
  { length: 21 },
  (_, index) => `CAT-${String(index + 1).padStart(2, "0")}`,
);
const results = [];
const errors = [];

if (!argumentsMap["--markers"] || !argumentsMap["--output"]) {
  process.stderr.write(
    "Usage: node verify-catalog-results.mjs --markers=<directory> --output=<file>\n",
  );
  process.exit(2);
}

for (const id of ids) {
  const markerPath = resolve(markersDirectory, `${id}.json`);
  if (!existsSync(markerPath)) {
    errors.push(`${id}: marker missing`);
    results.push({ id, status: "not_run", evidence: "CI marker missing" });
    continue;
  }
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  if (
    marker.id !== id ||
    marker.status !== "pass" ||
    typeof marker.evidence !== "string" ||
    marker.evidence.length === 0
  ) {
    errors.push(`${id}: invalid marker`);
    results.push({ id, status: "fail", evidence: "Invalid CI marker" });
    continue;
  }
  results.push(marker);
}

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "formal-web-ci-pr01",
  commitSha: process.env.GITHUB_SHA ?? "local",
  counts: {
    pass: results.filter((result) => result.status === "pass").length,
    fail: results.filter((result) => result.status === "fail").length,
    not_run: results.filter((result) => result.status === "not_run").length,
    environment_blocked: results.filter(
      (result) => result.status === "environment_blocked",
    ).length,
  },
  gates: results,
  hpoiRequests: 0,
  pr02Started: false,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

if (errors.length > 0) {
  process.stderr.write(
    `CAT result validation failed:\n${errors.map((error) => `  - ${error}`).join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write(`CAT result validation passed: ${summary.counts.pass}/21 pass.\n`);
