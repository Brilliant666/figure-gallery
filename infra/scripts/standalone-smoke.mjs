import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { repositoryRoot } from "./lib.mjs";

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf("=");
    return separator === -1
      ? [argument, true]
      : [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);
const appRoot = resolve(repositoryRoot, String(options["--app"] ?? "apps/web"));
const cleanRoot = resolve(
  String(options["--work"] ?? join(repositoryRoot, ".tmp", "pr00-standalone")),
);
const outputPath = resolve(
  String(options["--output"] ?? join(cleanRoot, "standalone-smoke.json")),
);
const composeFile = options["--compose-file"]
  ? resolve(String(options["--compose-file"]))
  : undefined;
const composeEnvironment = options["--compose-env"]
  ? resolve(String(options["--compose-env"]))
  : undefined;
const port = Number(options["--port"] ?? 33100);
const baseUrl = `http://127.0.0.1:${port}`;
const sourceStandalone = join(appRoot, ".next", "standalone");
const events = [];
let child;
let logDescriptor;
let logPath;

function record(name, status, details = {}) {
  events.push({ name, status, at: new Date().toISOString(), ...details });
}

function redact(value) {
  let output = String(value);
  for (const name of [
    "PAYLOAD_SECRET",
    "DATABASE_URI",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ]) {
    const secret = process.env[name];
    if (secret) output = output.replaceAll(secret, `[redacted:${name}]`);
  }
  try {
    const databasePassword = new URL(process.env.DATABASE_URI ?? "").password;
    if (databasePassword)
      output = output.replaceAll(
        databasePassword,
        "[redacted:DATABASE_PASSWORD]",
      );
  } catch {
    // Invalid environment values are reported by the application without echoing their contents.
  }
  return output;
}

function findServer(root, depth = 0) {
  const direct = join(root, "server.js");
  if (existsSync(direct)) return direct;
  if (depth >= 4) return undefined;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || [".next", "node_modules"].includes(entry.name))
      continue;
    const result = findServer(join(root, entry.name), depth + 1);
    if (result) return result;
  }
  return undefined;
}

async function waitForStatus(path, expected, timeoutMilliseconds = 60_000) {
  const startedAt = Date.now();
  let lastStatus = 0;
  while (Date.now() - startedAt < timeoutMilliseconds) {
    if (child && child.exitCode !== null)
      throw new Error(`standalone exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        redirect: "follow",
        signal: AbortSignal.timeout(3_000),
      });
      lastStatus = response.status;
      if (response.status === expected) return response;
    } catch {
      // The bounded poll deliberately retries transient connection failures.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(
    `${path} did not return ${expected}; last status was ${lastStatus}`,
  );
}

async function assertEndpoint(path, expected = 200) {
  const response = await waitForStatus(path, expected);
  const body = await response.text();
  record(path, "pass", { httpStatus: response.status });
  return body;
}

function startServer(serverPath, attempt) {
  logPath = join(cleanRoot, `server-${attempt}.log`);
  logDescriptor = openSync(logPath, "w");
  child = spawn(process.execPath, [serverPath], {
    cwd: dirname(serverPath),
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PORT: String(port),
    },
    stdio: ["ignore", logDescriptor, logDescriptor],
    windowsHide: true,
  });
  record(`standalone-start-${attempt}`, "pass", { pid: child.pid });
}

async function stopServer(attempt) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    new Promise((resolvePromise) =>
      child.once("exit", () => resolvePromise(true)),
    ),
    new Promise((resolvePromise) =>
      setTimeout(() => resolvePromise(false), 10_000),
    ),
  ]);
  if (!stopped) child.kill("SIGKILL");
  if (logDescriptor !== undefined) closeSync(logDescriptor);
  record(`standalone-stop-${attempt}`, "pass");
}

function compose(args) {
  if (!composeFile || !composeEnvironment)
    throw new Error(
      "compose file and environment are required for the S3 failure matrix",
    );
  const result = spawnSync(
    "docker",
    ["compose", "--env-file", composeEnvironment, "-f", composeFile, ...args],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.status !== 0)
    throw new Error(
      `docker compose ${args.join(" ")} failed: ${redact(result.stderr.trim())}`,
    );
}

function inspectLogs() {
  const warningPattern =
    /(?:failed to copy traced files|missing[^\n]*trace|nft[^\n]*(?:missing|warning)|could not find[^\n]*sharp)/i;
  const logs = readdirSync(cleanRoot)
    .filter((name) => /^server-\d+\.log$/.test(name))
    .map((name) => readFileSync(join(cleanRoot, name), "utf8"))
    .join("\n");
  if (warningPattern.test(logs))
    throw new Error(
      `standalone trace warning detected: ${redact(logs.match(warningPattern)?.[0] ?? "unknown warning")}`,
    );
  record("standalone-trace-warning-scan", "pass", { nftTracingWarnings: 0 });
}

function verifySharpRuntime(serverPath) {
  const script = `
    const sharp = require('sharp')
    sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true })
      .then(({ info }) => {
        if (info.width !== 1 || info.height !== 1 || info.format !== 'png') process.exit(2)
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      })
  `;
  const result = spawnSync(process.execPath, ["--eval", script], {
    cwd: dirname(serverPath),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `Sharp runtime processing failed: ${redact(`${result.stdout}\n${result.stderr}`.trim())}`,
    );
  }
  record("sharp-runtime", "pass", {
    nativeBindingLoaded: true,
    syntheticImage: "1x1-png-memory-only",
  });
}

async function smoke(attempt) {
  const liveBody = await assertEndpoint("/api/health/live");
  if (
    process.env.BUILD_VERSION &&
    !liveBody.includes(process.env.BUILD_VERSION)
  ) {
    throw new Error("liveness response does not contain BUILD_VERSION");
  }
  await assertEndpoint("/api/health/ready");
  const rootBody = await assertEndpoint("/");
  if (
    !rootBody.includes("Figure Gallery") ||
    !/formal initialization baseline/i.test(rootBody)
  ) {
    throw new Error(
      "root smoke page does not identify the formal initialization baseline",
    );
  }
  const adminBody = await assertEndpoint("/admin/login");
  const asset = [
    ...`${rootBody}\n${adminBody}`.matchAll(
      /["'](\/_next\/static\/[^"']+)["']/g,
    ),
  ][0]?.[1];
  if (!asset)
    throw new Error(
      "no Next.js static asset was discoverable from root/Admin HTML",
    );
  await assertEndpoint(asset);
  record(`standalone-smoke-${attempt}`, "pass");
}

async function main() {
  if (!existsSync(sourceStandalone))
    throw new Error(
      "apps/web/.next/standalone is missing; run the production build first",
    );
  rmSync(cleanRoot, { force: true, recursive: true });
  mkdirSync(cleanRoot, { recursive: true });
  cpSync(sourceStandalone, cleanRoot, { recursive: true });
  const serverPath = findServer(cleanRoot);
  if (!serverPath)
    throw new Error("server.js was not found in the clean standalone output");

  const staticSource = join(appRoot, ".next", "static");
  if (!existsSync(staticSource))
    throw new Error("apps/web/.next/static is missing");
  cpSync(staticSource, join(dirname(serverPath), ".next", "static"), {
    recursive: true,
  });
  const publicSource = join(appRoot, "public");
  if (existsSync(publicSource))
    cpSync(publicSource, join(dirname(serverPath), "public"), {
      recursive: true,
    });

  const sharpCandidates = [
    join(cleanRoot, "node_modules", "sharp", "package.json"),
    join(dirname(serverPath), "node_modules", "sharp", "package.json"),
    join(cleanRoot, "apps", "web", "node_modules", "sharp", "package.json"),
  ];
  if (!sharpCandidates.some(existsSync))
    throw new Error(
      "Sharp runtime files are absent from the clean standalone trace",
    );
  verifySharpRuntime(serverPath);

  startServer(serverPath, 1);
  await smoke(1);

  compose(["stop", "minio"]);
  await waitForStatus("/api/health/ready", 503, 45_000);
  await waitForStatus("/api/health/live", 200, 10_000);
  record("s3-readiness-failure", "pass", { ready: 503, live: 200 });
  compose(["start", "minio"]);
  await waitForStatus("/api/health/ready", 200, 60_000);
  record("s3-readiness-recovery", "pass", { ready: 200 });

  await stopServer(1);
  startServer(serverPath, 2);
  await smoke(2);
  await stopServer(2);
  inspectLogs();

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "pass",
    baseUrl,
    cleanStandaloneRoot: cleanRoot,
    sharpRuntime: true,
    nftTracingWarnings: 0,
    events,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Clean standalone smoke passed (${events.length} evidence events).\n`,
  );
}

try {
  await main();
} catch (error) {
  await stopServer("failure");
  const message = redact(
    error instanceof Error ? error.message : String(error),
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), status: "fail", error: message, events }, null, 2)}\n`,
    "utf8",
  );
  process.stderr.write(`Clean standalone smoke failed: ${message}\n`);
  process.exitCode = 1;
}
