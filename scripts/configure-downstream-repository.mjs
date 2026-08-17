#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const settings = JSON.parse(
  readFileSync(resolve(root, ".fastmigrate/repository-settings.json"), "utf8"),
);
const upstreamVersion = readFileSync(
  resolve(root, ".fastmigrate/upstream-version"),
  "utf8",
).trim();
const releaseBranch = settings.defaultBranch.replace(
  "{upstreamVersion}",
  upstreamVersion,
);
const mode = process.argv[2] ?? "--check";

function fail(message) {
  console.error(`Repository settings error: ${message}`);
  process.exit(1);
}

function validateSettings() {
  if (settings.schemaVersion !== 1) fail("unsupported schemaVersion");
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(settings.repository)) {
    fail("repository must be an owner/name pair");
  }
  if (settings.visibility !== "public") {
    fail("the downstream fork must remain public");
  }
  if (!/^\d+\.\d+\.\d+$/.test(upstreamVersion)) {
    fail("upstream-version must be semantic x.y.z");
  }
  if (!releaseBranch.startsWith("fastmigrate/")) {
    fail("the active release branch must use the fastmigrate/ namespace");
  }
  for (const key of ["main", "release"]) {
    const checks = settings.branchProtection?.[key]?.requiredStatusChecks;
    if (!Array.isArray(checks) || checks.some((check) => !check)) {
      fail(`${key} branch protection must declare requiredStatusChecks`);
    }
  }
}

function githubApi(path, { method = "GET", body } = {}) {
  const args = [
    "api",
    "--method",
    method,
    "-H",
    "Accept: application/vnd.github+json",
    "-H",
    "X-GitHub-Api-Version: 2022-11-28",
    path,
  ];
  if (body !== undefined) args.push("--input", "-");
  const result = spawnSync("gh", args, {
    cwd: root,
    encoding: "utf8",
    input: body === undefined ? undefined : JSON.stringify(body),
  });
  if (result.error) fail(`could not start gh: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    fail(`${method} ${path} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

function protectionBody(requiredStatusChecks) {
  return {
    required_status_checks: requiredStatusChecks.length
      ? { strict: true, contexts: requiredStatusChecks }
      : null,
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    required_linear_history: false,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: true,
    lock_branch: false,
    allow_fork_syncing: true,
  };
}

function branchPath(branch) {
  return `repos/${settings.repository}/branches/${encodeURIComponent(branch)}/protection`;
}

function applySettings() {
  githubApi(`repos/${settings.repository}`, {
    method: "PATCH",
    body: {
      description: settings.description,
      homepage: settings.homepage,
      visibility: settings.visibility,
      default_branch: releaseBranch,
      has_issues: settings.features.issues,
      has_projects: settings.features.projects,
      has_wiki: settings.features.wiki,
      allow_merge_commit: settings.mergePolicy.mergeCommits,
      allow_squash_merge: settings.mergePolicy.squashMerges,
      allow_rebase_merge: settings.mergePolicy.rebaseMerges,
      delete_branch_on_merge: settings.mergePolicy.deleteHeadBranches,
    },
  });

  const securityEndpoints = {
    vulnerabilityAlerts: "vulnerability-alerts",
    automatedSecurityFixes: "automated-security-fixes",
    privateVulnerabilityReporting: "private-vulnerability-reporting",
  };
  for (const [key, endpoint] of Object.entries(securityEndpoints)) {
    if (settings.security[key]) {
      githubApi(`repos/${settings.repository}/${endpoint}`, { method: "PUT" });
    }
  }

  githubApi(branchPath("main"), {
    method: "PUT",
    body: protectionBody(settings.branchProtection.main.requiredStatusChecks),
  });
  githubApi(branchPath(releaseBranch), {
    method: "PUT",
    body: protectionBody(settings.branchProtection.release.requiredStatusChecks),
  });
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} drifted (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function checkProtection(branch, expectedChecks) {
  const protection = githubApi(branchPath(branch));
  const actualChecks = (protection.required_status_checks?.contexts ?? []).sort();
  assertEqual(actualChecks, [...expectedChecks].sort(), `${branch} status checks`);
  assertEqual(protection.allow_force_pushes.enabled, false, `${branch} force pushes`);
  assertEqual(protection.allow_deletions.enabled, false, `${branch} deletion`);
  assertEqual(
    protection.required_conversation_resolution.enabled,
    true,
    `${branch} conversation resolution`,
  );
}

function checkSettings() {
  const repository = githubApi(`repos/${settings.repository}`);
  const expectedRepositoryValues = {
    fork: true,
    visibility: settings.visibility,
    description: settings.description,
    homepage: settings.homepage,
    default_branch: releaseBranch,
    has_issues: settings.features.issues,
    has_projects: settings.features.projects,
    has_wiki: settings.features.wiki,
    allow_merge_commit: settings.mergePolicy.mergeCommits,
    allow_squash_merge: settings.mergePolicy.squashMerges,
    allow_rebase_merge: settings.mergePolicy.rebaseMerges,
    delete_branch_on_merge: settings.mergePolicy.deleteHeadBranches,
  };
  for (const [key, expected] of Object.entries(expectedRepositoryValues)) {
    assertEqual(repository[key], expected, `repository ${key}`);
  }

  githubApi(`repos/${settings.repository}/vulnerability-alerts`);
  githubApi(`repos/${settings.repository}/automated-security-fixes`);
  const reporting = githubApi(
    `repos/${settings.repository}/private-vulnerability-reporting`,
  );
  assertEqual(reporting.enabled, true, "private vulnerability reporting");

  checkProtection("main", settings.branchProtection.main.requiredStatusChecks);
  checkProtection(
    releaseBranch,
    settings.branchProtection.release.requiredStatusChecks,
  );
}

validateSettings();

if (mode === "--validate") {
  console.log(`Repository settings valid for ${settings.repository} (${releaseBranch}).`);
} else if (mode === "--apply") {
  applySettings();
  checkSettings();
  console.log(`Repository settings applied and verified for ${settings.repository}.`);
} else if (mode === "--check") {
  checkSettings();
  console.log(`Repository settings match code for ${settings.repository}.`);
} else {
  fail("usage: configure-downstream-repository.mjs [--validate|--check|--apply]");
}
