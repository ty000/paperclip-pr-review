import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { coordinatorInstructions, reviewerInstructions, fixerInstructions, workflowSkill } from "./templates.js";

export const PLUGIN_ID = "ty000.plugin-pr-review";
export const ROLES = ["coordinator", "reviewer", "fixer"] as const;

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.8",
  displayName: "Paperclip PR Review",
  description: "Visible, contextual PR review and remediation with durable readiness gates.",
  author: "Paperclip PR Review contributors",
  categories: ["automation"],
  capabilities: [
    "api.routes.register", "database.namespace.migrate", "database.namespace.read", "database.namespace.write",
    "agents.managed", "projects.managed", "routines.managed", "skills.managed",
    "issues.read", "issues.create", "agents.read"
  ],
  entrypoints: { worker: "./dist/worker.js" },
  database: { namespaceSlug: "pr_review", migrationsDir: "migrations", coreReadTables: ["companies"] },
  agents: [
    { agentKey: "coordinator", displayName: "PR Review Coordinator", role: "manager", title: "PR review coordinator", capabilities: "Builds shared context, consolidates findings, and checks readiness.", adapterPreference: ["codex_local", "claude_local", "opencode_local", "process"], status: "paused", instructions: { content: coordinatorInstructions } },
    { agentKey: "reviewer", displayName: "PR Independent Reviewer", role: "engineer", title: "Independent PR reviewer", capabilities: "Reviews the pinned diff and validates corrections independently.", adapterPreference: ["codex_local", "claude_local", "opencode_local", "process"], status: "paused", instructions: { content: reviewerInstructions } },
    { agentKey: "fixer", displayName: "PR Remediator", role: "engineer", title: "PR correction engineer", capabilities: "Plans, changes, tests, and publishes approved corrections.", adapterPreference: ["codex_local", "claude_local", "opencode_local", "process"], status: "paused", instructions: { content: fixerInstructions } }
  ],
  projects: [{ projectKey: "pr-review", displayName: "PR Reviews", description: "Visible review and remediation missions managed by Paperclip PR Review.", status: "in_progress" }],
  skills: [{ skillKey: "pr-review-workflow", displayName: "PR Review Workflow", slug: "pr-review-workflow", description: "Context and evidence contract for the PR review team.", markdown: workflowSkill }],
  routines: [{ routineKey: "resume-missions", title: "Resume PR review missions", description: "List missions through GET /api/plugins/ty000.plugin-pr-review/api/missions?companyId=..., compare current GitHub base/head and invalidate moved refs, then POST /missions/{id}/resume only for waiting_external or needs_intervention missions after uncertain external effects have been reconciled. Never reset budgets. Close this routine issue after recording actions and blockers.", assigneeRef: { resourceKind: "agent", resourceKey: "coordinator" }, projectRef: { resourceKind: "project", resourceKey: "pr-review" }, status: "paused", concurrencyPolicy: "skip_if_active", triggers: [{ kind: "schedule", label: "Mission reconciliation", cronExpression: "*/15 * * * *", timezone: "UTC", enabled: false, signingMode: null, replayWindowSec: null }] }],
  apiRoutes: [
    { routeKey: "setup", method: "POST", path: "/setup", auth: "board", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "resources", method: "GET", path: "/resources", auth: "board", capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } },
    { routeKey: "start", method: "POST", path: "/missions", auth: "board", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "list", method: "GET", path: "/missions", auth: "board-or-agent", capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } },
    { routeKey: "get", method: "GET", path: "/missions/:missionId", auth: "board-or-agent", capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } },
    { routeKey: "context", method: "POST", path: "/missions/:missionId/context", auth: "board-or-agent", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "review", method: "POST", path: "/missions/:missionId/review", auth: "board-or-agent", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "decision", method: "POST", path: "/missions/:missionId/decision", auth: "board-or-agent", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "intent", method: "POST", path: "/missions/:missionId/intent", auth: "board-or-agent", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "correction", method: "POST", path: "/missions/:missionId/correction", auth: "board-or-agent", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "evidence", method: "POST", path: "/missions/:missionId/evidence", auth: "board-or-agent", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "effect", method: "POST", path: "/missions/:missionId/effects", auth: "board-or-agent", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "resume", method: "POST", path: "/missions/:missionId/resume", auth: "board-or-agent", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "invalidate", method: "POST", path: "/missions/:missionId/invalidate", auth: "board-or-agent", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } }
  ]
};

export default manifest;
