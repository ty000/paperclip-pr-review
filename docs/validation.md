# Validation report — 2026-09-29

## Scope and host identity

The test host came from the read-only Paperclip checkout at commit `61b3fd57a695614dc4a37e2303f426a34a9795cf`. `/api/health` reported `2026.916.0+197.git.61b3fd57a.dirty`; the reference checkout had pre-existing unrelated changes, so the host is not an immutable build of the commit alone. Node was 24.20.0 and pnpm 9.15.4. Two isolated Paperclip homes, company databases, and local repositories were used; no existing company or personal Paperclip home was changed. Both hosts loaded plugin `0.1.4` with a project, skill, routine, three paused agents, and a primary workspace. Adapters/models were configured from their host inventories, but credentials were not exercised. The scheduled routine remained disabled.

## Replaying the checks

Run the first commands from `plugin-pr-review` after starting a disposable Paperclip instance and creating a disposable company. Do not run the host test against a company whose issues or projects must be preserved.

```bash
pnpm install --offline --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm pack --pack-destination /tmp
node bin/pr-review.mjs plan --api "$PAPERCLIP_TEST_API" --company "$PAPERCLIP_TEST_COMPANY" --workspace "$PAPERCLIP_TEST_WORKSPACE" --instance disposable
node bin/pr-review.mjs install --api "$PAPERCLIP_TEST_API" --company "$PAPERCLIP_TEST_COMPANY" --workspace "$PAPERCLIP_TEST_WORKSPACE" --instance disposable
pnpm test:host
```

The final isolated run passed five unit tests and the host behavior test. `pnpm pack` included the worker and manifest bundles, migration, CLI, lockfile, sources, and the pinned SDK snapshots. The package tarball was opened and scanned for author home paths, fixture company IDs, validation ports, and a fixed author model; no match was found. The JSON behavior record [host-fixture-result.json](host-fixture-result.json) has SHA-256 `a8fbd34d61bc2279a72c8345f62c79ae3420078166d00872bce28ea0417c4ac8`. It records the local Git base, bad and fixed commit SHAs and the observed scenario outcomes.

A fresh local clone of commit `f33b83f679df6f0786c265c564a534dfe59fca55` also passed offline frozen install, typecheck, all five unit tests, build and pack without reading the source checkout's `node_modules` or ignored `dist`. Its tarball matched SHA-256 `c41644b699e1f1ce75696706c714bd88c1b5b9bafb3f5fe02cc5d3ad7a1a7b27`. This checks that the tracked SDK snapshots and lockfile suffice when the pnpm store already contains the public dependencies.

## Scenario results

| Required scenario | Evidence and result | Limit |
| --- | --- | --- |
| 1. Real isolated installation | Both disposable hosts reported plugin `ready` and loaded; project, skill, routine, three agents and workspace were returned by the host. | Agents were paused. |
| 2. Repeat installation | Running `install` again preserved project, skill, routine and agent IDs; a customized reviewer title remained. New template drift was reported instead of overwriting customized agent instructions. | Template updates require explicit reconciliation. |
| 3. Recovery | The first host was restarted, and a pre-existing mission still had its stage, SHA, budgets, findings and effects. `resume` created the next coordinator issue in the host behavior test. | No actual agent resumed. |
| 4. Shared context and stale SHA | The context hash was stable, carried to reviewer issues, and a review against the old SHA returned 422. | Agent consumption was simulated. |
| 5. Findings and decisions | Duplicate observations shared one finding ID; unit tests cover correction reservation and preservation. The state model retains rejected, duplicate, deferred and fixed dispositions. | Human judgment of a finding was simulated. |
| 6. Full local path | The Git fixture committed a wrong operator, executed `add(2,3)` and observed `-1`, committed the correction and observed `5`; simulated agents completed final review and readiness. | No GitHub push or real agent. |
| 7. Readiness refusal | Host test refused red CI, pending CI, conflict, missing approval and unexplained red job. Unit test refused partial coverage and unresolved finding. | Submitted platform evidence is not independently fetched. |
| 8. Budgets and concurrent triggers | Concurrent starts reused one mission and phase issue. Resume/effect reservations were idempotent; a second attempt after the limit reached `budget_exhausted`. The state persisted after host restart. | Operational time limits are not enforced beyond finite attempt counts. |
| 9. Uncertain external effect | A stable effect key reserved twice yielded one ledger entry; confirmation followed an actual local fixture commit. | The agent must query the external target before confirming or retrying a real GitHub write. |
| 10. Portable second instance | Export from host one had no credentials, IDs or local path. `install --from` on host two preserved resource IDs; `diff --from` returned `equal: true` with the same model selections. | No mission/history backup or credential transfer. |

## Lifecycle states

| State | Host one | Host two |
| --- | --- | --- |
| Package built and packed | Yes | Same source package |
| Plugin installed and loaded | Yes, `0.1.4`, `ready` | Yes, `0.1.4`, `ready` |
| Managed resources installed | Yes | Yes |
| Adapter/model and workspace configured | Yes | Yes |
| Automation activated | No; agents paused, routine paused, schedule disabled | No; same |
| Fixture review executed | Yes, simulated agents on real host | No |
| Actual Paperclip agent executed | No | No |
| Real GitHub PR canary executed | No | No |

Both disposable hosts were stopped after readback. The table reports their observed state while running; it does not claim that their plugin workers remain loaded now.

## Remaining proof boundary

The current plugin trusts agent-submitted GitHub evidence. Its state machine can establish internal consistency and reject incomplete claims, but it cannot independently establish the current GitHub remote state. This blocks a product-level assertion that a real PR is **verified clean and mergeable**. The target PR, GitHub permissions, adapter credentials, and authorization for external actions were not supplied, and the run expressly prohibited real PR comments, pushes and merges. A later canary requires an explicit repository/PR, a disposable or approved branch, host credentials, separate modification/push/comment/thread permissions, and live readback of the GitHub state. The product never merges.
