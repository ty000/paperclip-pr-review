# Installation and operations

## Target and prerequisites

Use a dedicated WSL checkout of this repository and a Paperclip host compatible with the pinned SDK. The tested host is commit `61b3fd57a695614dc4a37e2303f426a34a9795cf`, Node 24.20.0, pnpm 9.15.4. The `--api` URL and `--company` ID identify the host API and company; `--instance` is recorded as an operator assertion because `/api/health` does not expose instance ID. Use `--commit EXPECTED_SHA` to fail if the host commit differs. `--workspace` is an absolute local path or an HTTPS Git repository URL. A divergent existing primary workspace stops installation without overwrite.

On authenticated hosts, set `PAPERCLIP_API_KEY` in the shell. The CLI sends it as a bearer token and never writes it to disk. The Paperclip host and its agent adapters own GitHub and model credentials. Verify a usable GitHub connection, repository permissions, adapter authentication, and the selected model in Paperclip before activation. The CLI checks adapter availability and model listing; it cannot prove credential usability.

## Install and update

Run from `plugin-pr-review`:

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm build
node bin/pr-review.mjs plan --api HOST_URL --company COMPANY_ID --workspace WORKSPACE --instance INSTANCE --commit HOST_COMMIT
node bin/pr-review.mjs install --api HOST_URL --company COMPANY_ID --workspace WORKSPACE --instance INSTANCE --commit HOST_COMMIT
node bin/pr-review.mjs status --api HOST_URL --company COMPANY_ID --workspace WORKSPACE --instance INSTANCE
```

`plan` is read only and reports package, plugin, resource, workspace, and lifecycle states. `install` installs a local path plugin, reconciles resources by stable keys, then binds a primary workspace. It can be rerun after interruption. Managed resource reconciliation preserves changed agent instructions and titles; inspect `defaultDrift` in `status` after an upgrade. Review and explicitly apply desired template updates in Paperclip. Do not assume that `update` overwrites customized resources.

After editing or pulling new sources, run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and:

```bash
node bin/pr-review.mjs update --api HOST_URL --company COMPANY_ID --workspace WORKSPACE --instance INSTANCE --commit HOST_COMMIT
```

The update calls Paperclip's plugin upgrade API when the package version changed and reconciles owned resources. It does not migrate another company's data or reset its configuration. Inspect `status` before and after.

## Configure and activate

```bash
node bin/pr-review.mjs configure --api HOST_URL --company COMPANY_ID --adapter ADAPTER_TYPE --model MODEL_ID
node bin/pr-review.mjs status --api HOST_URL --company COMPANY_ID --workspace WORKSPACE
node bin/pr-review.mjs activate --api HOST_URL --company COMPANY_ID --bindings-verified true
```

`configure` can target a subset with `--roles coordinator,reviewer`. It validates that the adapter is loaded and the model appears in the company model list. It preserves other agent fields. `activate` resumes the three agents and enables the 15-minute reconciliation schedule after the operator asserts that workspace, GitHub, model credentials, and permissions have been checked. It is intentionally a separate step; installation does not enable automatic triggers.

## Start and follow a review

```bash
node bin/pr-review.mjs start --api HOST_URL --company COMPANY_ID --repository OWNER/REPO --pr 123 --allow-modify true --allow-push true --max-corrections 3 --max-resumes 8
node bin/pr-review.mjs status --api HOST_URL --company COMPANY_ID --workspace WORKSPACE
```

`start` creates or reuses one mission for the company, repository, and PR, and creates the first assigned Paperclip issue. The rights are independent: `--allow-modify`, `--allow-push`, `--allow-comment`, `--allow-resolve-threads`; each defaults to false. It does not itself read GitHub or push. The coordinator prepares versioned context, the reviewer reviews, the fixer records intent and corrects, then the reviewer performs the final independent pass. Their issue work is visible in Paperclip; the worker stores state and validates transitions.

Use the mission API for inspection:

```bash
curl -H "Authorization: Bearer $PAPERCLIP_API_KEY" 'HOST_URL/api/plugins/ty000.plugin-pr-review/api/missions?companyId=COMPANY_ID'
curl -H "Authorization: Bearer $PAPERCLIP_API_KEY" 'HOST_URL/api/plugins/ty000.plugin-pr-review/api/missions/MISSION_ID?companyId=COMPANY_ID'
```

For a mission in `waiting_external` or `needs_intervention`, first compare live base/head and reconcile any reserved external effect. Then run:

```bash
node bin/pr-review.mjs resume --api HOST_URL --company COMPANY_ID --mission MISSION_ID
```

This reserves one finite resume attempt and creates a coordinator readiness issue. A second resume while that issue is active is rejected. If the PR base/head moved, submit `POST /missions/MISSION_ID/invalidate` with `companyId`, the new `baseSha` and `headSha`, `reason`, and `sourceRef` before resuming. The schedule instructs the coordinator to do this check; the plugin cannot fetch GitHub state itself.

## Export and second instance

```bash
node bin/pr-review.mjs export --api HOST_URL --company COMPANY_ID --out pr-review-config.json
node bin/pr-review.mjs diff --api HOST_URL --company COMPANY_ID --from pr-review-config.json
node bin/pr-review.mjs install --api SECOND_HOST_URL --company SECOND_COMPANY_ID --workspace SECOND_WORKSPACE --instance SECOND_INSTANCE --from pr-review-config.json
node bin/pr-review.mjs diff --api SECOND_HOST_URL --company SECOND_COMPANY_ID --from pr-review-config.json
```

The portable JSON carries product/version, target Paperclip version and commit, stable resource keys, and selected adapter/model types. It excludes credentials, IDs, local paths, issues, mission state, and run history. A repository URL may be included when the workspace uses one. The second host must independently provide its company, workspace, credentials, connections, and available adapters/models. `install --from` validates the schema, product and package version, and model availability. `diff` reports exact portable JSON equality. It does not compare runtime mission data and is not a backup. Back up the Paperclip database and credential store separately using the host's supported procedure.

## Recovery and troubleshooting

- `plugin.status` or health not ready: inspect `lastError`, rebuild, then run `update`. Do not activate agents until loaded.
- Resource `defaultDrift`: inspect customized content against current source; explicit Paperclip editing is required to adopt new defaults while retaining customizations.
- Workspace divergence: point `--workspace` at the current primary or resolve the binding in Paperclip; the installer will not replace it.
- A reserved external push/comment/thread effect after timeout: read the remote state and record a receipt with `POST /missions/MISSION_ID/effects`; never repeat the write merely because its HTTP response was lost.
- `waiting_external`: obtain missing or pending checks, approvals, thread status, conflict state, and current base/head before retrying readiness.
- `budget_exhausted`: stop automated work and obtain an operator decision. The mission does not reset budgets on restart or SHA change.
- A `verified_mergeable` verdict is an agent attestation. Recheck current GitHub state externally before merging; this product never merges.
