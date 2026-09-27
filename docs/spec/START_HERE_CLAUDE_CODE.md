# START HERE --- Prompt for Claude Code

Build BrittVideo as a production application using every file in this
package.

Read in this order: 1. LATEST_REQUIREMENTS_DELTA.md 2.
CLAUDE_CODE_BUILD_BRIEF.md 3.
BrittVideo_Master_Developer_Build_Specification_A-Z.pdf 4.
DATA_MODEL_AND_STATE.md 5. INTEGRATIONS_AND_AUTOMATION.md 6.
ACCEPTANCE_CHECKLIST.md 7. Current HTML prototype

Rules: - Newer delta decisions override stale wording in the master PDF
or prototype. - Do not rename Premier back to Premium. - Do not treat
the single-file HTML prototype as the production architecture. - Do not
remove a business requirement merely because an integration is not yet
configured. Implement a clean adapter/stub and visible
configuration/health state. - Never expose secrets client-side. - Never
require the owner to diagnose raw technical errors. - Preserve data and
history across failures and upgrades. - Build in staged, testable
increments and keep a CHANGELOG. - Before changing a locked business
rule, flag it explicitly for owner decision. - Provide setup
instructions suitable for a Mac owner and a developer. - Include
automated tests for critical rules and failure/retry paths. - Do not
mark the application production-ready until every applicable item in
ACCEPTANCE_CHECKLIST.md passes.

Begin by producing: A. proposed production architecture, B.
repository/folder structure, C. database schema/migrations, D.
environment-variable template with no real secrets, E. implementation
plan mapped to acceptance gates, then implement Phase 1.
