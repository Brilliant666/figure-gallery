import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { fail, readJson, repositoryRoot } from "./lib.mjs";

const appRoot = join(repositoryRoot, "apps", "web");
const packageJson = readJson(join(appRoot, "package.json"));
const lockJson = readJson(join(appRoot, "package-lock.json"));
const requireFromApp = createRequire(join(appRoot, "package.json"));
const outputArgument = process.argv.find((argument) =>
  argument.startsWith("--output="),
);
const outputPath = outputArgument
  ? resolve(repositoryRoot, outputArgument.slice("--output=".length))
  : undefined;
const errors = [];
const checks = [];

function check(name, condition, details = {}) {
  checks.push({ name, status: condition ? "pass" : "fail", ...details });
  if (!condition) errors.push(name);
}

function lockVersions(name) {
  const suffix = `/node_modules/${name}`;
  return Object.entries(lockJson.packages ?? {})
    .filter(
      ([path]) => path === `node_modules/${name}` || path.endsWith(suffix),
    )
    .map(([path, metadata]) => ({ path, version: metadata.version }));
}

function exactLockVersion(name, expected) {
  const versions = lockVersions(name);
  check(
    `${name}-lock-version`,
    versions.length > 0 &&
      versions.every(({ version }) => version === expected),
    { expected, versions },
  );
}

exactLockVersion("sharp", "0.35.3");
exactLockVersion("fast-uri", "3.1.5");
exactLockVersion("postcss", "8.5.23");
exactLockVersion("next", "16.2.11");
exactLockVersion("payload", "3.87.1");
exactLockVersion("@payloadcms/db-postgres", "3.87.1");
exactLockVersion("@payloadcms/next", "3.87.1");
exactLockVersion("@payloadcms/storage-s3", "3.87.1");
exactLockVersion("@payloadcms/ui", "3.87.1");
exactLockVersion("undici", "7.29.0");
exactLockVersion("image-dimensions", "2.5.1");
exactLockVersion("js-yaml", "4.3.1");
exactLockVersion("nanoid", "3.3.17");
check("image-size-runtime-removed", lockVersions("image-size").length === 0, {
  versions: lockVersions("image-size"),
});
check("next-direct-pin", packageJson.dependencies?.next === "16.2.11", {
  actual: packageJson.dependencies?.next,
});
check("payload-direct-pin", packageJson.dependencies?.payload === "3.87.1", {
  actual: packageJson.dependencies?.payload,
});

const fastUri = requireFromApp("fast-uri");
const fastUriPackage = readJson(
  join(appRoot, "node_modules", "fast-uri", "package.json"),
);
check("fast-uri-runtime-version", fastUriPackage.version === "3.1.5", {
  actual: fastUriPackage.version,
});
const literalBackslash = fastUri.parse(
  "https://allowed.example.invalid\\@127.0.0.1",
);
check(
  "fast-uri-literal-backslash-authority",
  /literal backslash/i.test(literalBackslash.error ?? ""),
  { error: literalBackslash.error ?? null },
);
const encodedAuthority = "https://allowed.example.invalid%5c@127.0.0.1";
const fastEncoded = fastUri.parse(encodedAuthority);
const whatwgEncoded = new URL(encodedAuthority);
check(
  "fast-uri-whatwg-final-host",
  fastEncoded.host === whatwgEncoded.hostname,
  { fastUriHost: fastEncoded.host, whatwgHost: whatwgEncoded.hostname },
);

const postcss = requireFromApp("postcss");
const postcssPackage = readJson(
  join(appRoot, "node_modules", "postcss", "package.json"),
);
check("postcss-runtime-version", postcssPackage.version === "8.5.23", {
  actual: postcssPackage.version,
});
const maliciousCss =
  'body { content: "</style><script>alert(1)</script><style>"; }';
const safeCss = postcss.parse(maliciousCss).toResult().css;
check("postcss-style-escape", !safeCss.toLowerCase().includes("</style>"), {
  version: postcssPackage.version,
});
for (const relativePath of [
  "src/app/(frontend)/styles.css",
  "src/admin/catalog/catalog.module.css",
]) {
  const css = readFileSync(join(appRoot, relativePath), "utf8");
  const result = postcss.parse(css, { from: relativePath }).toResult().css;
  check(`postcss-parse-${relativePath}`, result.length > 0);
}

const sharp = requireFromApp("sharp");
check("sharp-runtime-version", sharp.versions?.sharp === "0.35.3", {
  actual: sharp.versions?.sharp,
});
const source = sharp({
  create: {
    width: 4,
    height: 3,
    channels: 4,
    background: { r: 45, g: 110, b: 180, alpha: 1 },
  },
});
const sharpFormats = {};
for (const format of ["png", "jpeg", "webp"]) {
  const buffer = await source.clone()[format]().toBuffer();
  const metadata = await sharp(buffer).metadata();
  sharpFormats[format] = {
    bytes: buffer.length,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
  };
  check(
    `sharp-${format}`,
    buffer.length > 0 &&
      metadata.format === format &&
      metadata.width === 4 &&
      metadata.height === 3,
    sharpFormats[format],
  );
}
const resized = await source.clone().resize(2, 2).png().toBuffer();
const resizedMetadata = await sharp(resized).metadata();
check(
  "sharp-resize-metadata",
  resizedMetadata.width === 2 &&
    resizedMetadata.height === 2 &&
    resizedMetadata.format === "png",
  {
    format: resizedMetadata.format,
    width: resizedMetadata.width,
    height: resizedMetadata.height,
  },
);
check("sharp-libvips-runtime", Boolean(sharp.versions?.vips), {
  sharp: sharp.versions?.sharp,
  vips: sharp.versions?.vips,
});

let commit = "unknown";
let npmVersion = packageJson.packageManager?.replace(/^npm@/, "") ?? "unknown";
let npmVersionSource = "packageManagerPin";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  npmVersion = execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["--version"],
    {
      cwd: appRoot,
      encoding: "utf8",
    },
  ).trim();
  npmVersionSource = "runtime";
} catch {
  // GitHub CI verifies the executable npm version independently before this script.
}

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit,
  nodeVersion: process.version,
  npmVersion,
  npmVersionSource,
  status: errors.length === 0 ? "pass" : "fail",
  packages: {
    fastUri: lockVersions("fast-uri"),
    next: lockVersions("next"),
    payload: lockVersions("payload"),
    postcss: lockVersions("postcss"),
    sharp: lockVersions("sharp"),
  },
  sharpRuntime: {
    formats: sharpFormats,
    sharp: sharp.versions?.sharp,
    vips: sharp.versions?.vips,
  },
  checks,
  errors,
};

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

if (errors.length > 0) {
  fail("Formal dependency security check failed.", errors);
} else {
  process.stdout.write(
    `Formal dependency security passed (${checks.length} checks; Sharp ${sharp.versions?.sharp}, libvips ${sharp.versions?.vips}).\n`,
  );
}
