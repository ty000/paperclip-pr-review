# Paperclip PR Review

Paperclip PR Review is a local Paperclip plugin for contextual pull request review and remediation. It declares three visible Paperclip agents, a project, four skills, and a paused reconciliation routine. Each agent has a role charter in its materialized `AGENTS.md`; skill selection and synchronization are explicit installation steps. A durable mission ledger pins the review context and findings to the PR base and head. It never merges a PR.

## Quick start

Requirements: Node 24, pnpm 9, a running compatible Paperclip instance, a company ID, and a repository workspace. The tested host is Paperclip `2026.916.0+197.git.61b3fd57a` at commit `61b3fd57a695614dc4a37e2303f426a34a9795cf`. The host API must be reachable from this shell. Keep API credentials in `PAPERCLIP_API_KEY` when authentication is enabled.

```bash
cd plugin-pr-review
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build
node bin/pr-review.mjs plan --api http://127.0.0.1:3100 --company COMPANY_ID --workspace /absolute/repository/path --instance INSTANCE_NAME
node bin/pr-review.mjs install --api http://127.0.0.1:3100 --company COMPANY_ID --workspace /absolute/repository/path --instance INSTANCE_NAME
node bin/pr-review.mjs status --api http://127.0.0.1:3100 --company COMPANY_ID --workspace /absolute/repository/path --instance INSTANCE_NAME
```

`install` creates the resources in a paused state. Configure a model offered by the target host, verify its credentials and workspace, then activate:

```bash
node bin/pr-review.mjs configure --api http://127.0.0.1:3100 --company COMPANY_ID --adapter codex_local --model MODEL_ID
node bin/pr-review.mjs activate --api http://127.0.0.1:3100 --company COMPANY_ID --bindings-verified true
node bin/pr-review.mjs start --api http://127.0.0.1:3100 --company COMPANY_ID --repository OWNER/REPO --pr 123 --allow-modify true --allow-push true
```

The last command creates a mission and assigns its context issue. Set `--allow-comment true` and `--allow-resolve-threads true` separately if those actions are authorized. It performs no merge. A review with corrections requires modify and push rights. Inspect the mission and its Paperclip issues before acting on the verdict.

See [installation and operations](docs/operations.md), [architecture and contracts](docs/architecture.md), and [validation evidence](docs/validation.md). The [plugin package](plugin-pr-review/README.md) contains its own command reference.

## Evidence boundary

The plugin validates submitted, SHA-pinned review and readiness evidence. It does not itself query GitHub or authenticate the submitted evidence against GitHub. A `verified_mergeable` mission is therefore an **agent attestation** until an operator checks the current PR, rules, checks, jobs, approvals, conversations, and remote head independently. The isolated tests cover a real Paperclip host with simulated agents and a local Git fixture. They do not prove an actual agent run or a GitHub PR canary.
