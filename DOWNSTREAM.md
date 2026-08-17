# FastMigrate downstream

This private repository is the canonical source for the Pages CMS build used
by FastMigrate. It preserves the complete public upstream history while keeping
FastMigrate release work and operational patches separate from customer sites
and infrastructure secrets.

## Remotes

- `origin`: `git@github.com:fastmigrate/pagescms.git`
- `upstream`: `https://github.com/hunvreus/pagescms.git`

No credentials, customer repositories, deployment inventories, or production
configuration belong in this repository.

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

## Upstream contributions

Generic fixes should be proposed to upstream. Because the canonical downstream
is private, create or reuse a separate public GitHub fork only as the transport
for those pull requests. Remove a downstream patch after an approved upstream
release contains the equivalent behavior and the release passes our smoke.
