# Downstream patches

This file lists behavior that differs from the upstream tag underlying the
active FastMigrate release branch.

| ID | Status | Area | Purpose | Removal trigger |
| --- | --- | --- | --- | --- |
| FM-001 | Active | Dependency error UX | Show a safe, actionable English message and one explicit retry action when the GitHub API returns 5xx or cannot be reached. | An upstream release provides an equivalent classified error state and passes the FastMigrate CMS smoke. |

Each active patch must remain a separate commit, include proportionate tests,
and avoid customer- or infrastructure-specific configuration.
