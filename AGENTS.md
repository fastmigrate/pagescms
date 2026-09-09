# FastMigrate Pages CMS instructions

Read `DOWNSTREAM.md` and `PATCHES.md` before changing this fork. The active
`fastmigrate/<version>` branch is the integration/release base; upstream `main`
is not the target for downstream patches. Preserve unrelated work and use a
separate branch/worktree when another task owns the current checkout.

## Required pull request and Codex review loop

Owner instruction, 2026-09-09: PRs and the Codex review loop are mandatory for
technical changes in this repository. Only an explicit owner instruction for
the specific task can waive them; agents must not invent exceptions. The owner authorizes pushing scoped
non-secret changes to this repository's configured origin, opening the PR,
posting `@codex review`, fixing findings, requesting further reviews, and merging
once the gates below pass. Do not ask for these routine steps again unless the
owner narrows the scope or a tool explicitly blocks an action.

1. Run proportionate local tests and a browser smoke for changed editor behavior.
2. Push a focused branch and open a PR against the active downstream release
   branch. Opening a PR is part of the work, not an optional handoff.
3. Comment `@codex review` on the PR and record the requested head SHA.
4. Wait for the completed review. Inspect review bodies, inline review threads,
   ordinary PR comments, and CI. A queued/running review, reaction indicating
   work started, absent comments, or passing CI is not a clean review.
5. Fix actionable findings, add appropriate regression coverage, rerun checks,
   push the corrections, then comment `@codex review` again. Repeat until the
   final head has a completed review with no unresolved actionable findings.
   Do not dismiss findings merely to finish; document evidence for a justified
   non-fix and obtain reviewer resolution. Do not request repeated unchanged
   reviews hoping that a finding disappears.
6. Before final review, fetch and integrate the latest target branch, rerun
   checks, and request review of the resulting head. Immediately before merge,
   verify that the current target tip is still an ancestor of the reviewed head.
   If the target advanced, repeat integration, checks, and review. Verify
   required CI and relevant local checks pass on that final head. Review completion without a completed clean verdict is blocked,
   including exhausted review quota or unavailable review service.
7. Merge with an expected-head guard without bypassing branch protection. Verify the merge
   result and preserve the reviewed/merged SHAs and validation in durable docs.

A local sandbox limitation may defer a build to the equivalent CI job; report
that boundary truthfully and require the CI build to pass. Do not weaken tests
or security gates. Do not send customer data, secrets, or production credentials
to this public repository. Production rollout is separate from PR merge and
uses the existing immutable-release pin and shared Tools deployment gate.
