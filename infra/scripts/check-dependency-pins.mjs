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
  next: "16.2.10",
  payload: "3.86.0",
  react: "19.2.7",
  "react-dom": "19.2.7",
  sharp: "0.34.5",
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

  if (errors.length > 0) {
    fail("Dependency pin check failed.", errors);
  } else {
    process.stdout.write(
      `Dependency pins passed (${Object.keys(direct).length} exact direct dependencies).\n`,
    );
  }
}
