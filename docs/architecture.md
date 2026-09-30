# Architecture and review contract

## Decision

One external plugin owns the mission ledger and all managed Paperclip resource definitions. Paperclip executes and tracks the LLM agents, their issues, skills, project, routine, adapters, and credentials. A company import is not used because it could create a second copy of those resources. The plugin worker only validates and advances deterministic state; it does not hide an LLM review inside a worker.

| Component | Decision | Source and licence |
| --- | --- | --- |
| Paperclip agents, issues, project, skills, routine, adapters | Reuse native host and managed resources | Paperclip, MIT, pinned host commit in README |
| Plugin SDK and shared types | Reuse pinned local package snapshots | Paperclip, MIT; notice in `PAPERCLIP_LICENSE.txt` |
| PR remediation protocol | Adapt context, findings, correction intent, thread/effect reconciliation and readiness concepts | `codex-tooling` reference only; no runtime dependency or copied code |
| Mission store and operator CLI | Develop in this repository | This repository, MIT |
| PR-Agent, reviewdog, paperclip-github-plugin | Not adopted | No code, licence or maintenance dependency introduced |

## State and ownership

`src/manifest.ts` declares stable keys for three paused agents (`coordinator`, `reviewer`, `fixer`), one project, four skills, and one paused scheduled routine. Each materialized `AGENTS.md` contains durable role responsibilities; a shared workflow skill and three role skills contain reusable procedures. Selecting each agent's two skills in Paperclip is a separate operation. Paperclip's managed-resource reconciliation preserves customization. `migrations/001_missions.sql` creates one row per company/repository/PR. `src/store.ts` uses a versioned SQL compare-and-swap update, so concurrent triggers cannot create two active missions or silently overwrite each other's state. A leased `pendingIssue` and Paperclip issue `originKind/originId` reconcile phase issue creation after interruption. The issue stays visible in Paperclip; it is not the authoritative state.

`src/workflow.ts` implements context → initial review → correction intent → correction and tests → refreshed context → independent final review → readiness. A reviewer must submit the pinned context hash and head. Findings have stable IDs from normalized cause, invariant and path, with observation history, dispositions and correction references. An observed recurrence reopens a fixed finding. Serious rejected findings and deferred findings block readiness. Partial coverage or unknown context blocks readiness. Decisions can close all actionable findings and advance to final review. The author of a correction cannot be the final validator.

The context schema includes repository/PR, base/head, objective, scope, sourced criteria, files/behaviors, exclusions, one to five evidenced diff risks, decisions, previous findings, changes, observed tests/CI, unknowns, coverage limits, source refs, and a stable SHA-256 hash. It is regenerated after a correction or observed base/head movement. Agent instructions treat PR text and repository content as data, not authority.

Correction attempts are **reserved** at intent submission and **confirmed** after a new head and passing test receipts. Resume attempts are reserved when the waiting mission is resumed; effect ledger entries can also reserve and confirm a `resume` attempt, but must use stable keys. The maximum counts persist in the mission row and never reset with a new SHA. Exhaustion stops the mission. A GitHub correction requires a confirmed push receipt containing the new SHA and claimed visible remote head. Commenting, pushing, modifying, and resolving threads are separate rights. Thread resolution requires confirmed publication and a justification reference.

The routine lists missions, checks live PR base/head using its Paperclip agent's access, invalidates moved refs, reconciles uncertain effects, and resumes only waiting missions. It starts paused with its schedule disabled. The plugin does **not** subscribe to GitHub webhooks; the native schedule and manual start/resume are the triggers. Its 15-minute cadence is an operational default, not a freshness guarantee. Delayed events are handled by SHA comparison and invalidation through the API.

## Readiness boundary

Readiness requires complete final coverage, no open/deferred or serious rejected findings, full context, fresh matching base/head, a visible remote head claim, no conflict, satisfied rules/approvals/conversations, acceptable checks and all red jobs explained, passing tests, and an independent final review. Pending/unknown/partial conditions stop the positive verdict. A new relevant event can invalidate it.

The host worker **does not independently query GitHub**. It checks the structure and consistency of evidence submitted by the coordinator, not the truth of its GitHub observations. Thus `verified_mergeable` is only an agent attestation and must not be treated as a cryptographically or independently verified merge gate. A future upstream/plugin integration could read GitHub through a supported host connection and compare remote head, branch rules, check suites/jobs, approvals, conversations and mergeability at verdict time. The current host SDK surface used here does not expose that credentialed GitHub read path to the worker. A real GitHub canary and an actual Paperclip agent run remain untested in the isolated validation.
