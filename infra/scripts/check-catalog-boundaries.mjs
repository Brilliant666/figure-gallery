import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { fail, repositoryRoot, toPosix } from "./lib.mjs";

const errors = [];
const sourceRoot = join(repositoryRoot, "apps", "web", "src");
const contractsRoot = join(repositoryRoot, "packages", "domain-contracts");
const laterTypes = [
  "CandidateClient",
  "SourceRecord",
  "CandidateRecord",
  "CandidateImage",
  "ReviewWorkItem",
  "SystemSetting",
  "MediaAsset",
  "FigureImage",
];
const allowedCollectionSlugs = [
  "works",
  "characters",
  "character-aliases",
  "manufacturers",
  "figure-prototypes",
  "figure-prototype-characters",
  "figure-versions",
  "operation-logs",
];

function walk(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return walk(path);
    return [path];
  });
}

const sourceFiles = walk(sourceRoot).filter((path) =>
  [".js", ".mjs", ".ts", ".tsx"].includes(extname(path).toLowerCase()),
);
for (const path of sourceFiles) {
  const content = readFileSync(path, "utf8");
  const name = toPosix(relative(repositoryRoot, path));
  for (const type of laterTypes) {
    if (new RegExp(`\\b${type}\\b`).test(content)) {
      errors.push(`${name}: PR-02 or later type ${type} is outside scope`);
    }
  }
  if (content.toLowerCase().includes(`${["h", "p", "o", "i"].join("")}.net`)) {
    errors.push(`${name}: forbidden source host appears in formal source`);
  }
}

const collectionRoot = join(sourceRoot, "collections", "catalog");
for (const slug of allowedCollectionSlugs) {
  const pattern = new RegExp(`slug:\\s*['\"]${slug.replaceAll("-", "\\-")}['\"]`);
  const matches = walk(collectionRoot).filter((path) => pattern.test(readFileSync(path, "utf8")));
  if (matches.length !== 1) errors.push(`${slug}: expected exactly one formal Collection config`);
}

const internalContextPath = join(sourceRoot, "domain", "catalog", "internal-context.ts");
const catalogServicesPath = join(sourceRoot, "domain", "catalog", "services.ts");
const catalogCollectionCommonPath = join(
  sourceRoot,
  "collections",
  "catalog",
  "common.ts",
);
for (const path of sourceFiles) {
  const content = readFileSync(path, "utf8");
  const name = toPosix(relative(repositoryRoot, path));
  if (
    path !== internalContextPath &&
    /authorizedRequests\s*=|new WeakSet<PayloadRequest>/.test(content)
  ) {
    errors.push(`${name}: private catalog capability duplicated`);
  }
  if (
    path !== internalContextPath &&
    path !== catalogServicesPath &&
    /\bwithCatalogDomainWrite\b/.test(content)
  ) {
    errors.push(`${name}: catalog write capability used outside the domain service`);
  }
  if (
    path !== internalContextPath &&
    path !== catalogCollectionCommonPath &&
    /\b(?:assertCatalogDomainWrite|denyCatalogGenericWrite)\b/.test(content)
  ) {
    errors.push(`${name}: catalog capability assertion used outside the guarded Collection layer`);
  }
  if (/\b(?:req\.)?payload\.(?:create|update|delete)\s*\(/.test(content)) {
    if (path !== catalogServicesPath) {
      errors.push(`${name}: formal Payload mutation exists outside the catalog domain service`);
    }
  }
  if (/catalogDomainWriteCapability/.test(content)) {
    errors.push(`${name}: forgeable string catalog capability is forbidden`);
  }
}

for (const path of walk(contractsRoot)) {
  if (![".json", ".ts"].includes(extname(path).toLowerCase())) continue;
  const content = readFileSync(path, "utf8");
  if (/@payloadcms|from\s+['\"](?:payload|next|react)|apps\/web|spikes\/|research\//i.test(content)) {
    errors.push(`${toPosix(relative(repositoryRoot, path))}: domain contract is not framework-independent`);
  }
}

const payloadConfig = readFileSync(join(sourceRoot, "payload.config.ts"), "utf8");
if (!payloadConfig.includes("CatalogCollections")) errors.push("payload.config.ts: catalog Collections are not registered");
if (!payloadConfig.includes("CatalogCommandEndpoint")) errors.push("payload.config.ts: command endpoint is not registered");

if (errors.length) {
  fail("Catalog boundary check failed.", errors);
} else {
  process.stdout.write(
    `Catalog boundary check passed (${sourceFiles.length} source files; PR-02+ types absent).\n`,
  );
}
