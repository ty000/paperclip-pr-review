# PR Review agent and skill migration

`migration_prewrite: required` for changes to an existing Paperclip company. The source refactor alone has no Paperclip state effect. Before a live write, snapshot the target company's actual three instruction bundles, revisions, agent configurations, desired skill lists, managed skill content and drift, active runs, and mission state. Compare them with this plan. A missing or customized clause needs an explicit disposition; never use a broad managed reset to erase it.

## Instruction disposition from source version 0.1.8

The old `src/templates.ts` contained the following groups. The current live bundles may differ and must be audited separately.

| Source clause | Destination | Reason |
| --- | --- | --- |
| Agent identity, issue responsibility, untrusted PR input, rights, no merge, truthful evidence and stop/escalation | Each role's materialized `AGENTS.md`, authored in `src/templates.ts` | Durable mandate and behavior |
| Stage sequence, mission identity, context hash, API credential/scope, retries, history, budgets and readiness invariants | Managed `pr-review-workflow` skill | Shared method and evidence contract |
| Coordinator context, risk selection, dispositions, GitHub evidence and resume procedure | Managed `pr-review-coordination` skill | Task-triggered coordinator method |
| Independent initial/final review, coverage, finding schema and recurrence handling | Managed `pr-review-code-review` skill | Task-triggered reviewer method |
| Intent, bounded correction, effect reservation, publication and correction schema | Managed `pr-review-remediation` skill | Task-triggered fixer method |
| Adapter/model/credentials, activation and selected skills | Paperclip agent configuration | Effective configuration is not granted by prose |
| Mission-specific objective, acceptance criteria, PR refs and prior decisions | Current mission record and assigned issue | These change per PR |
| Actor permissions, route authorization and state transitions | Paperclip host and plugin worker | Server-enforced invariants |

Role selection is `coordinator` → workflow + coordination, `reviewer` → workflow + code review, `fixer` → workflow + remediation. The CLI resolves the actual company skill keys from the installed managed resources and uses the specialized `/agents/:id/skills/sync` endpoint in `add` mode. It does not replace unrelated selections.

## Existing-company cutover

1. Identify exact host/company/plugin/agent IDs. Read all three actual bundles, including entry file, revision/hash and operator changes. Read all four company skill records, content/version/drift, each agent's `/skills` snapshot, and active mission/run state. Preserve a redacted pre-state with content hashes outside the plugin's managed records.
2. Finish or pause affected active runs under the existing authority. Build and upgrade the versioned package. Run setup to reconcile the three newly declared skills. Read back plugin version, worker health, all skill IDs and content. Existing `pr-review-workflow` content is not automatically replaced. Review the entire existing skill record and file inventory against the new declaration, including customized metadata. The host has no atomic compare-and-swap for managed skill reset, so the plugin exposes no automatic reset operation. Migrate any existing skill only in an exclusive maintenance window through Paperclip's supported skill editing workflow, preserving a complete pre-state and reading back content, metadata, and files. If that cannot be done safely, retain the drift and stop the cutover.
3. Confirm all four skills contain the intended new procedures. Run `skills-plan`, then `sync-skills` while the agents are idle or paused. Read back every desired list and skill snapshot. Preserve unrelated keys. A partial adapter sync leaves the saved desired list in place; reconcile it before retrying.
4. For each actual `AGENTS.md`, map all clauses against the table above, including custom ones. After the selected skills are available, write only the reviewed shorter role charter with the current bundle revision/hash precondition. Read back content and revision. A concurrent edit requires a fresh diff; a timeout requires readback before another write. Keep old procedures until the corresponding skill is available, or use an authorized controlled pause.
5. Confirm source template, installed skill content, live role charter, desired keys, adapter snapshot and actual mount in the next authorized run separately for each agent. A new run ID and logs are required to claim execution. Do not wake an agent just to manufacture proof. Resume automatic work only when the affected role has its method and no conflicting instructions.

This migration is not atomic. If an intermediate write fails, retain the observed partial state and review a restoration using the saved content and fresh concurrency token. Do not infer rollback from a package upgrade or a successful setup. Inspect the current Paperclip service and actual company state before executing the live sequence.
