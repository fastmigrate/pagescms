#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import nextEnv from "@next/env";
import {
  getPackageManagerInvocation,
  getInheritedSandboxKeys,
  isLocalSandboxDatabaseUrl,
  isPlaceholderValue,
  isValidCryptoKey,
} from "./dev-environment.mjs";

const { loadEnvConfig } = nextEnv;

const root = process.cwd();
const envPath = resolve(root, ".env.local");
const requiredGitHubKeys = [
  "GITHUB_APP_ID",
  "GITHUB_APP_NAME",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_WEBHOOK_SECRET",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
];

if (!existsSync(envPath)) {
  fail("Missing .env.local. Copy .env.local.example, then configure a GitHub App installed only on a sandbox repository.");
}

const inheritedSandboxKeys = getInheritedSandboxKeys();
if (inheritedSandboxKeys.length > 0) {
  fail(
    `Refusing inherited sandbox credentials (${inheritedSandboxKeys.join(", ")}). Unset them and keep local CMS credentials only in .env.local.`,
  );
}

loadEnvConfig(root);

for (const key of requiredGitHubKeys) {
  const value = process.env[key]?.trim();
  if (isPlaceholderValue(key, value)) {
    fail(`Missing sandbox GitHub App value: ${key}`);
  }
}

if (!isValidCryptoKey(process.env.CRYPTO_KEY)) {
  fail("CRYPTO_KEY must be a 32-byte standard base64 value. Generate one with: openssl rand -base64 32");
}

const postgresPort = process.env.PAGESCMS_POSTGRES_PORT?.trim() || "5432";
if (!isLocalSandboxDatabaseUrl(process.env.DATABASE_URL, postgresPort)) {
  fail(
    `DATABASE_URL must target localhost on the Compose PostgreSQL port (${postgresPort}).`,
  );
}

let packageManager;
try {
  packageManager = getPackageManagerInvocation();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
if (!existsSync(packageManager.cli)) {
  fail(`Package-manager CLI is missing: ${packageManager.cli}`);
}

await run("docker", ["compose", "-f", "compose.dev.yml", "up", "-d", "--wait", "postgres"]);
await run(packageManager.command, [packageManager.cli, "run", "db:migrate"]);

console.log("\nLocal Pages CMS is starting with the configured sandbox GitHub App.");
console.log("The database remains available after exit; stop it with npm run dev:local:down.\n");

const child = spawn(packageManager.command, [packageManager.cli, "run", "dev"], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const commandProcess = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    commandProcess.on("error", rejectRun);
    commandProcess.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with status ${code}`));
    });
  });
}

function fail(message) {
  console.error(`Local development setup failed: ${message}`);
  process.exit(1);
}
