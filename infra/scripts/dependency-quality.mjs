import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { fail, readJson, repositoryRoot } from "./lib.mjs";

const packageJson = readJson(
  join(repositoryRoot, "apps", "web", "package.json"),
);
const lockJson = readJson(
  join(repositoryRoot, "apps", "web", "package-lock.json"),
);
const nodeModules = join(repositoryRoot, "apps", "web", "node_modules");
const outputArgument = process.argv.find((argument) =>
  argument.startsWith("--output="),
);
const outputPath = outputArgument
  ? resolve(repositoryRoot, outputArgument.slice("--output=".length))
  : undefined;
const direct = { ...packageJson.dependencies, ...packageJson.devDependencies };
const productionNames = new Set(Object.keys(packageJson.dependencies ?? {}));
const allowedLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "Unlicense",
]);
const errors = [];
const licenses = [];

for (const [name, requested] of Object.entries(direct).sort(([left], [right]) =>
  left.localeCompare(right),
)) {
  const installedPath = join(nodeModules, ...name.split("/"), "package.json");
  if (!existsSync(installedPath)) {
    errors.push(`${name}: package is not installed`);
    continue;
  }
  const installed = JSON.parse(readFileSync(installedPath, "utf8"));
  const license =
    typeof installed.license === "string" ? installed.license : "UNKNOWN";
  licenses.push({
    name,
    requested,
    installed: installed.version,
    license,
    production: productionNames.has(name),
  });
  if (installed.version !== requested)
    errors.push(
      `${name}: installed ${installed.version}, expected ${requested}`,
    );
  if (!allowedLicenses.has(license))
    errors.push(
      `${name}: direct dependency license ${license} requires review`,
    );
}

const coreNames = [
  "payload",
  "@payloadcms/next",
  "@payloadcms/db-postgres",
  "@payloadcms/storage-s3",
  "next",
  "react",
  "react-dom",
  "sharp",
];
const duplicates = {};
for (const name of coreNames) {
  const suffix = `/node_modules/${name}`;
  const versions = new Map();
  for (const [path, metadata] of Object.entries(lockJson.packages ?? {})) {
    if (path === `node_modules/${name}` || path.endsWith(suffix)) {
      if (!versions.has(metadata.version)) versions.set(metadata.version, []);
      versions.get(metadata.version).push(path);
    }
  }
  duplicates[name] = Object.fromEntries(versions);
  const installationCount = [...versions.values()].reduce(
    (total, paths) => total + paths.length,
    0,
  );
  if (versions.size !== 1 || installationCount !== 1) {
    errors.push(
      `${name}: expected one installed core package, found ${installationCount} installation(s) across ${[...versions.keys()].join(", ") || "no versions"}`,
    );
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  directDependencyCount: licenses.length,
  licenses,
  corePackageVersions: duplicates,
  status: errors.length === 0 ? "pass" : "fail",
  errors,
};

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

if (errors.length > 0) {
  fail("Dependency quality check failed.", errors);
} else {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
