# Downstream patches

This file lists behavior that differs from the upstream tag underlying the
active FastMigrate release branch.

| ID | Status | Area | Purpose | Removal trigger |
| --- | --- | --- | --- | --- |
| FM-001 | Active | Dependency error UX | Show a safe, actionable English message and one explicit retry action when the GitHub API returns 5xx or cannot be reached. | An upstream release provides an equivalent classified error state and passes the FastMigrate CMS smoke. |
| FM-002 | Active | Dependency security | Pin patched Better Auth, Next.js, and Nodemailer versions and refresh compatible transitive dependencies so production audit has no known high or critical advisory. | An upstream release includes equivalent or newer reviewed versions and passes the FastMigrate security and CMS smokes. |
| FM-003 | Active | GitHub App setup | Generate a GitHub-valid App manifest with the accepted `emails` permission and GitHub-generated webhook secret. | Upstream includes the equivalent helper fixes and a newly created test App validates the flow. |

Each active patch must remain a separate commit, include proportionate tests,
and avoid customer- or infrastructure-specific configuration.
