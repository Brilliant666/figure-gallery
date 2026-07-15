import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [id, markerDirectory, ...evidenceParts] = process.argv.slice(2);
if (
  !/^CAT-(?:0[1-9]|1[0-9]|2[0-1])$/.test(id ?? "") ||
  !markerDirectory ||
  evidenceParts.length === 0
) {
  process.stderr.write(
    "Usage: node mark-catalog-gate.mjs CAT-01 <marker-directory> <evidence summary>\n",
  );
  process.exit(2);
}

const directory = resolve(markerDirectory);
mkdirSync(directory, { recursive: true });
writeFileSync(
  resolve(directory, `${id}.json`),
  `${JSON.stringify({ id, status: "pass", evidence: evidenceParts.join(" "), recordedAt: new Date().toISOString() }, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${id} marked pass.\n`);
