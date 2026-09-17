#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { buildFixtureEnvironment } from "./dev-environment.mjs";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(
  process.execPath,
  [nextBin, "dev", "--webpack", ...process.argv.slice(2)],
  {
    env: buildFixtureEnvironment(),
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`Fixture server failed to start: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
