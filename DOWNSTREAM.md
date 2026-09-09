# FastMigrate downstream

This public fork is the canonical source for the Pages CMS build used by
FastMigrate. It preserves the complete upstream relationship while keeping
FastMigrate release work and operational patches separate from customer sites
and infrastructure secrets.

## Remotes

- `origin`: `git@github.com:fastmigrate/pagescms.git`
- `upstream`: `https://github.com/hunvreus/pagescms.git`

No credentials, customer repositories, deployment inventories, or production
configuration belong in this repository.

## Repository configuration

GitHub metadata, features, security switches, the default branch, and branch
protection live in `.fastmigrate/repository-settings.json`. Restore or
reconcile them with an authenticated GitHub CLI session:

```sh
npm run repo:settings:apply
npm run repo:settings:check
```

Both commands are idempotent. `--apply` uses convergent PUT/PATCH operations
and verifies the result; transient GitHub 502/503/504 responses receive bounded
automatic retries. `--check` is read-only and reports drift. CI runs the offline
schema check, while authenticated infrastructure recovery runs the live
reconciliation. No token or organization credential is stored here.

## Branch and release policy

- `main` mirrors the approved upstream base without FastMigrate patches.
- `fastmigrate/<upstream-version>` branches start at the matching upstream tag
  and contain one reviewable commit per active downstream patch.
- The active `fastmigrate/<upstream-version>` branch is the GitHub default
  branch so its CI and scheduled upstream check remain active.
- Deployed commits receive immutable tags in the form
  `fastmigrate-v<upstream-version>-p<revision>`.
- Production pins an exact commit or image digest. Branches and moving tags are
  never deployment inputs.

## Pull requests and review

Follow the required PR → `@codex review` → fix → re-review loop in `AGENTS.md`.
After a clean completed review of the final head and passing required checks,
merge into the active release branch without another routine permission prompt.
Opening the PR, tagging Codex, waiting for its result, and fixing/reviewing again
are part of the implementation task. Production rollout remains a separate gate.

## Updating the upstream base

1. Fetch upstream without merging it into an active release branch:
   `git fetch upstream --tags`.
2. Review the new upstream tag, database migrations, environment changes, and
   dependency changes.
3. Create `fastmigrate/<new-version>` from the new upstream tag.
4. Reapply the downstream maintenance commit and only the patches still listed
   as active in `PATCHES.md`.
5. Run `npm ci`, `npm test`, `npm run lint`, and the production build.
6. Exercise the authenticated CMS smoke against a non-customer repository.
7. Make the accepted release branch the repository default so scheduled checks
   execute from it.
8. Tag the accepted commit and update the pinned production artifact through
   the SSR Websites deployment gate.

Updates are proposed automatically but never deployed automatically. Database
migrations require a backup and an explicit rollout review.

## Dependency security

- Dependabot proposes grouped minor and patch updates against the active
  default release branch. Major upgrades remain explicit maintenance work.
- CI rejects high or critical production dependency advisories with
  `npm audit --omit=dev --audit-level=high`.
- Tooling advisories are reviewed separately because `drizzle-kit` currently
  reports a moderate `esbuild` advisory whose suggested automated fix is a
  breaking downgrade. The deployed image currently retains `drizzle-kit` for
  migrations, but it never starts the affected development server.
- Security updates pass the same test, lint, build, database, and authenticated
  smoke gates as upstream version updates. They are never auto-merged or
  auto-deployed.

## Upstream contributions

Generic fixes should be proposed directly from a focused branch in this public
fork. Remove a downstream patch after an approved upstream release contains the
equivalent behavior and the release passes our smoke.
