import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { fail, readJson, repositoryRoot, toPosix } from "./lib.mjs";

const errors = [];
const formalRoots = ["apps/web", "packages"];
const requiredDirectories = [
  "apps/web",
  "packages/domain-contracts",
  "packages/candidate-client",
  "packages/media-contracts",
  "packages/test-fixtures",
  "infra/compose",
  "infra/examples",
  "infra/scripts",
];
const readableExtensions = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".scss",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const runtimeExtensions = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".scss",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const postPr01BusinessTypes = [
  "CandidateClient",
  "CandidateRecord",
  "CandidateImage",
  "MediaAsset",
  "ReviewWorkItem",
  "SystemSetting",
];
const allowedCollectionFiles = new Set([
  "CatalogCollections.ts",
  "Media.ts",
  "Users.ts",
  "catalog/Character.ts",
  "catalog/CharacterAlias.ts",
  "catalog/CatalogItem.ts",
  "catalog/FigurePrototype.ts",
  "catalog/FigurePrototypeCharacter.ts",
  "catalog/FigureVersion.ts",
  "catalog/Manufacturer.ts",
  "catalog/OperationLog.ts",
  "catalog/SourceRecord.ts",
  "catalog/Work.ts",
  "catalog/common.ts",
  "catalog/index.ts",
]);
const forbiddenSourceDomain = `${["h", "p", "o", "i"].join("")}.net`;

function walk(root) {
  if (!existsSync(root)) return [];
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (
        [".next", "node_modules", "coverage", "dist", "build"].includes(
          entry.name,
        )
      )
        continue;
      output.push(...walk(path));
    } else {
      output.push(path);
    }
  }
  return output;
}

for (const directory of requiredDirectories) {
  if (!existsSync(join(repositoryRoot, directory)))
    errors.push(`${directory}: required PR-00 boundary directory is missing`);
}

const formalFiles = formalRoots.flatMap((root) =>
  walk(join(repositoryRoot, root)),
);
const productionFiles = walk(join(repositoryRoot, "apps", "web", "src")).filter(
  (path) => {
    const normalized = toPosix(relative(repositoryRoot, path));
    return (
      !normalized.includes("/tests/") &&
      !normalized.includes(".test.") &&
      !normalized.includes(".spec.")
    );
  },
);

for (const path of formalFiles) {
  if (!runtimeExtensions.has(extname(path).toLowerCase())) continue;
  const normalized = toPosix(relative(repositoryRoot, path));
  const content = readFileSync(path, "utf8");
  if (
    /(?:^|["'`/\\])(?:\.\.\/)*(?:spikes|research)(?:["'`/\\]|$)/im.test(content)
  ) {
    errors.push(
      `${normalized}: formal source references a research/spike path`,
    );
  }
  if (content.toLowerCase().includes(forbiddenSourceDomain)) {
    errors.push(
      `${normalized}: forbidden external source domain appears in formal source`,
    );
  }
}

for (const path of productionFiles) {
  if (!readableExtensions.has(extname(path).toLowerCase())) continue;
  const normalized = toPosix(relative(repositoryRoot, path));
  const content = readFileSync(path, "utf8");
  for (const name of postPr01BusinessTypes) {
    if (new RegExp(`\\b${name}\\b`).test(content)) {
      errors.push(
        `${normalized}: PR-02 or later business type ${name} is outside PR-01`,
      );
    }
  }
  if (/@payloadcms\/db-sqlite|sqlite(?:3)?:/i.test(content)) {
    errors.push(
      `${normalized}: SQLite is forbidden in formal runtime configuration`,
    );
  }
  if (/\bprodMigrations\b/.test(content)) {
    errors.push(
      `${normalized}: prodMigrations must not replace explicit formal migration execution`,
    );
  }
}

const collectionsRoot = join(
  repositoryRoot,
  "apps",
  "web",
  "src",
  "collections",
);
if (existsSync(collectionsRoot)) {
  const collectionFiles = walk(collectionsRoot)
    .filter((path) => /\.[cm]?[jt]sx?$/.test(path))
    .map((path) => toPosix(relative(collectionsRoot, path)));
  for (const collectionFile of collectionFiles) {
    if (!allowedCollectionFiles.has(collectionFile)) {
      errors.push(
        `apps/web/src/collections/${collectionFile}: collection is outside the PR-01 catalog boundary`,
      );
    }
  }
}

const appRoot = join(repositoryRoot, "apps", "web", "src", "app");
if (existsSync(appRoot)) {
  const routeFiles = walk(appRoot)
    .filter((path) => /(?:route|page)\.[cm]?[jt]sx?$/.test(path))
    .map((path) => toPosix(relative(appRoot, path)));
  const allowedRouteFiles = new Set([
    "(frontend)/page.tsx",
    "(payload)/admin/[[...segments]]/page.tsx",
    "(payload)/api/[...slug]/route.ts",
    "(payload)/api/graphql/route.ts",
    "(payload)/api/graphql-playground/route.ts",
    "api/health/live/route.ts",
    "api/health/ready/route.ts",
  ]);
  for (const routeFile of routeFiles) {
    if (!allowedRouteFiles.has(routeFile)) {
      errors.push(
        `apps/web/src/app/${routeFile}: business/example page or API is outside PR-00 scope`,
      );
    }
  }
}

for (const obsoleteFile of [
  "apps/web/Dockerfile",
  "apps/web/docker-compose.yml",
  "apps/web/pnpm-lock.yaml",
  "apps/web/yarn.lock",
]) {
  if (existsSync(join(repositoryRoot, obsoleteFile))) {
    errors.push(
      `${obsoleteFile}: the formal app uses npm and infra/compose; remove the generic scaffold artifact`,
    );
  }
}
if (existsSync(join(repositoryRoot, "package.json"))) {
  errors.push(
    "package.json: a repository-root workspace is outside the approved formal layout",
  );
}

const packagePath = join(repositoryRoot, "apps", "web", "package.json");
if (existsSync(packagePath)) {
  const packageJson = readJson(packagePath);
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  for (const [name, value] of Object.entries(dependencies)) {
    if (name === "@payloadcms/db-sqlite")
      errors.push("apps/web/package.json: SQLite adapter is forbidden");
    if (
      /^(?:file|link|workspace):/i.test(value) &&
      /(?:spikes|research)/i.test(value)
    ) {
      errors.push(
        `apps/web/package.json: ${name} points at a research/spike path`,
      );
    }
  }
  for (const scriptName of ["build", "dev", "start"]) {
    const command = packageJson.scripts?.[scriptName];
    if (
      typeof command !== "string" ||
      !/\bNEXT_TELEMETRY_DISABLED=1\b/.test(command)
    ) {
      errors.push(
        `apps/web/package.json: ${scriptName} must disable Next.js telemetry`,
      );
    }
  }
}

const tsconfigPath = join(repositoryRoot, "apps", "web", "tsconfig.json");
if (existsSync(tsconfigPath)) {
  const tsconfig = readFileSync(tsconfigPath, "utf8");
  if (/(?:spikes|research)/i.test(tsconfig))
    errors.push(
      "apps/web/tsconfig.json: formal path aliases include research/spikes",
    );
}

const runtimeConfigurationFiles = [
  join(repositoryRoot, "infra", "compose", "compose.yml"),
  join(repositoryRoot, ".github", "workflows", "formal-web-ci.yml"),
].filter(existsSync);
for (const path of runtimeConfigurationFiles) {
  const content = readFileSync(path, "utf8");
  const normalized = toPosix(relative(repositoryRoot, path));
  if (content.toLowerCase().includes(forbiddenSourceDomain)) {
    errors.push(
      `${normalized}: forbidden external source domain appears in runtime configuration`,
    );
  }
  if (/\b(?:mongo|sqlite)(?::|\/|@)/i.test(content)) {
    errors.push(
      `${normalized}: unsupported database appears in formal runtime configuration`,
    );
  }
  if (
    /(?:^|["'`/\\])(?:\.\.\/)*(?:spikes|research)(?:["'`/\\]|$)/im.test(content)
  ) {
    errors.push(
      `${normalized}: runtime configuration reads a research/spike path`,
    );
  }
  if (/\bdocker\s+build\b/i.test(content)) {
    errors.push(
      `${normalized}: PR-00 has no Docker build context; standalone is validated from traced output`,
    );
  }
}

if (errors.length > 0) {
  fail("Formal boundary check failed.", errors);
} else {
  process.stdout.write(
    `Formal boundary check passed (${formalFiles.length} formal files inspected; legacy research/spike contents were not read).\n`,
  );
}
