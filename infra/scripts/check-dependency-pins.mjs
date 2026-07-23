import { existsSync } from "node:fs";
import { join } from "node:path";

import { fail, readJson, repositoryRoot } from "./lib.mjs";

const packagePath = join(repositoryRoot, "apps", "web", "package.json");
const lockPath = join(repositoryRoot, "apps", "web", "package-lock.json");
const errors = [];
const requiredPins = {
  "@payloadcms/db-postgres": "3.86.0",
  "@payloadcms/next": "3.86.0",
  "@payloadcms/storage-s3": "3.86.0",
  next: "16.2.11",
  payload: "3.86.0",
  react: "19.2.7",
  "react-dom": "19.2.7",
  sharp: "0.35.3",
};
const requiredOverrides = [
  ["fast-uri", "3.1.4"],
  ["postcss", "8.5.10"],
  ["sharp", "$sharp"],
];
const requiredLockVersions = {
  "fast-uri": "3.1.4",
  next: "16.2.11",
  payload: "3.86.0",
  postcss: "8.5.10",
  sharp: "0.35.3",
};
const exactStableSemver = /^\d+\.\d+\.\d+$/;

if (!existsSync(packagePath) || !existsSync(lockPath)) {
  fail("Dependency pin check failed.", [
    "apps/web/package.json and package-lock.json are both required",
  ]);
} else {
  const packageJson = readJson(packagePath);
  const lockJson = readJson(lockPath);
  const direct = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const lockRoot = lockJson.packages?.[""];

  if (packageJson.packageManager !== "npm@10.9.8") {
    errors.push(
      "packageManager must be exactly npm@10.9.8 for the Node 22.23.1 CI baseline",
    );
  }
  if (packageJson.engines?.node !== ">=22.12.0 <23") {
    errors.push('engines.node must be exactly ">=22.12.0 <23"');
  }
  if (
    "pnpm" in packageJson ||
    packageJson.engines?.pnpm ||
    packageJson.engines?.yarn
  ) {
    errors.push(
      "pnpm/yarn configuration is forbidden in the formal npm application",
    );
  }

  for (const [name, expected] of Object.entries(requiredPins)) {
    if (direct[name] !== expected)
      errors.push(
        `${name}: expected ${expected}, found ${direct[name] ?? "missing"}`,
      );
  }
  for (const [name, value] of Object.entries(direct)) {
    if (!exactStableSemver.test(value))
      errors.push(
        `${name}: direct dependencies must use an exact stable x.y.z pin (found ${value})`,
      );
  }
  for (const [path, expected] of requiredOverrides) {
    const actual = path
      .split(".")
      .reduce((value, segment) => value?.[segment], packageJson.overrides);
    if (actual !== expected) {
      errors.push(
        `${path}: expected npm override ${expected}, found ${actual ?? "missing"}`,
      );
    }
  }

  if (lockJson.lockfileVersion !== 3)
    errors.push(
      `package-lock lockfileVersion must be 3 (found ${lockJson.lockfileVersion})`,
    );
  if (!lockRoot) {
    errors.push("package-lock root package entry is missing");
  } else {
    const lockDirect = {
      ...lockRoot.dependencies,
      ...lockRoot.devDependencies,
    };
    for (const [name, value] of Object.entries(direct)) {
      if (lockDirect[name] !== value)
        errors.push(
          `${name}: package-lock root pin ${lockDirect[name] ?? "missing"} differs from package.json ${value}`,
        );
    }
  }

  for (const [name, expected] of Object.entries(requiredLockVersions)) {
    const suffix = `/node_modules/${name}`;
    const matches = Object.entries(lockJson.packages ?? {}).filter(
      ([path]) => path === `node_modules/${name}` || path.endsWith(suffix),
    );
    if (matches.length === 0) {
      errors.push(`${name}: package-lock contains no installed package node`);
      continue;
    }
    for (const [path, metadata] of matches) {
      if (metadata.version !== expected) {
        errors.push(
          `${name}: expected every lock node to be ${expected}, found ${metadata.version} at ${path}`,
        );
      }
    }
  }

  for (const [path, metadata] of Object.entries(lockJson.packages ?? {})) {
    if (!path || !metadata.resolved) continue;
    if (!metadata.resolved.startsWith("https://registry.npmjs.org/")) {
      errors.push(
        `${path}: package must resolve from the official npm registry`,
      );
    }
    if (!metadata.integrity) {
      errors.push(`${path}: resolved package is missing an integrity digest`);
    }
  }

  if (errors.length > 0) {
    fail("Dependency pin check failed.", errors);
  } else {
    process.stdout.write(
      `Dependency pins passed (${Object.keys(direct).length} exact direct dependencies).\n`,
    );
  }
}
