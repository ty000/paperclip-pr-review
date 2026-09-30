import { definePlugin, runWorker, type PluginContext, type PluginApiRequestInput } from "@paperclipai/plugin-sdk";
import { randomUUID } from "node:crypto";
import { createMission, applyCommand, validateContext, type Mission, type MissionCommand } from "./workflow.js";
import { MissionStore } from "./store.js";
import { PLUGIN_ID, ROLES, SKILL_KEYS } from "./manifest.js";

let context: PluginContext | null = null;
function host(): PluginContext { if (!context) throw new Error("Plugin is not ready"); return context; }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required"); return value as Record<string, unknown>; }
function str(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`); return value.trim(); }

async function resources(ctx: PluginContext, companyId: string) {
  const project = await ctx.projects.managed.get("pr-review", companyId);
  const skills = Object.fromEntries(await Promise.all(SKILL_KEYS.map(async key => [key, await ctx.skills.managed.get(key, companyId)] as const)));
  const routine = await ctx.routines.managed.get("resume-missions", companyId);
  const agents = Object.fromEntries(await Promise.all(ROLES.map(async key => [key, await ctx.agents.managed.get(key, companyId)] as const)));
  return { project, skill: skills["pr-review-workflow"], skills, routine, agents };
}

async function setup(ctx: PluginContext, companyId: string) {
  const project = await ctx.projects.managed.reconcile("pr-review", companyId);
  const skillEntries = [];
  for (const key of SKILL_KEYS) skillEntries.push([key, await ctx.skills.managed.reconcile(key, companyId)] as const);
  const skills = Object.fromEntries(skillEntries);
  const agents = Object.fromEntries(await Promise.all(ROLES.map(async key => [key, await ctx.agents.managed.reconcile(key, companyId)] as const)));
  const routine = await ctx.routines.managed.reconcile("resume-missions", companyId);
  return { project, skill: skills["pr-review-workflow"], skills, routine, agents };
}

async function ensurePhaseIssue(ctx: PluginContext, mission: Mission): Promise<Mission> {
  if (!mission.pendingIssue) return mission;
  const store = new MissionStore(ctx.db);
  const key = mission.pendingIssue.key;
  const owner = randomUUID();
  const claimed = await store.change(mission.companyId, mission.id, current => {
    const pending = current.pendingIssue;
    if (!pending || pending.key !== key || (pending.leaseUntil && Date.parse(pending.leaseUntil) > Date.now())) return current;
    return { ...current, pendingIssue: { ...pending, leaseOwner: owner, leaseUntil: new Date(Date.now() + 60_000).toISOString() } };
  });
  if (claimed.pendingIssue?.leaseOwner !== owner) return claimed;
  const pending = claimed.pendingIssue;
  const originKind = `plugin:${PLUGIN_ID}:phase`;
  const originId = `${mission.id}:${pending.key}`;
  const existing = await ctx.issues.list({ companyId: mission.companyId, originKind, originId, limit: 10 });
  if (existing.length > 1) throw new Error("Duplicate phase issues detected; operator reconciliation required");
  let phaseIssue = existing[0];
  if (!phaseIssue) {
    const agent = await ctx.agents.managed.get(pending.role, mission.companyId);
    const project = await ctx.projects.managed.get("pr-review", mission.companyId);
    if (!agent.agentId || !project.projectId) throw new Error("Managed agents and project must be installed before dispatch");
    phaseIssue = await ctx.issues.create({
      companyId: mission.companyId, projectId: project.projectId, parentId: mission.rootIssueId ?? undefined,
      title: `${pending.role}: ${mission.repository}#${mission.prNumber} (${mission.headSha.slice(0, 12) || "new"})`,
      description: pending.description, status: "todo", priority: "high", assigneeAgentId: agent.agentId,
      originKind, originId, billingCode: `pr-review:${mission.id}`
    });
  }
  const updated = await store.change(mission.companyId, mission.id, current => {
    if (current.pendingIssue?.key !== pending.key || current.pendingIssue.leaseOwner !== owner) return current;
    return { ...current, rootIssueId: current.rootIssueId ?? phaseIssue!.id, pendingIssue: null, issueIds: { ...current.issueIds, [pending.key]: phaseIssue!.id } };
  });
  return updated;
}

async function run(input: PluginApiRequestInput) {
  const ctx = host();
  const store = new MissionStore(ctx.db);
  const companyId = input.companyId;
  if (input.routeKey === "resources") return { body: await resources(ctx, companyId) };
  if (input.routeKey === "setup") return { body: await setup(ctx, companyId) };
  if (input.routeKey === "list") return { body: await store.list(companyId) };
  if (input.routeKey === "start") {
    const body = object(input.body);
    const repository = str(body.repository, "repository");
    const prNumber = Number(body.prNumber);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isInteger(prNumber) || prNumber < 1) throw new Error("A GitHub owner/repo and positive PR number are required");
    const installed = await resources(ctx, companyId);
    if (!installed.project.projectId || ROLES.some(key => !installed.agents[key]?.agentId)) throw new Error("Run setup before starting a mission");
    if (body.mode !== "fixture") {
      const workspace = installed.project.project?.primaryWorkspace;
      if (!workspace || ROLES.some(key => installed.agents[key]?.agent?.status !== "idle" || installed.agents[key]?.agent?.adapterType === "process")) throw new Error("Real PR mission requires bound workspace and active runnable agents");
    }
    const mission = createMission({ id: randomUUID(), companyId, repository, prNumber, maxCorrections: body.maxCorrections, maxResumes: body.maxResumes, mode: body.mode, rights: body.rights });
    const persisted = await store.create(mission);
    return { status: 201, body: await ensurePhaseIssue(ctx, persisted) };
  }
  const missionId = str(input.params.missionId, "missionId");
  if (input.routeKey === "get") {
    const mission = await store.get(companyId, missionId);
    return { status: mission ? 200 : 404, body: mission ?? { error: "Mission not found" } };
  }
  const body = object(input.body);
  const current = await store.get(companyId, missionId);
  if (!current) return { status: 404, body: { error: "Mission not found" } };
  if (input.actor.actorType === "agent") {
    const expectedRole = input.routeKey === "review" ? "reviewer" : input.routeKey === "intent" || input.routeKey === "correction" || (input.routeKey === "effect" && body.kind === "push") ? "fixer" : "coordinator";
    const agent = await ctx.agents.managed.get(expectedRole, companyId);
    if (agent.agentId !== input.actor.agentId) return { status: 403, body: { error: `Only the ${expectedRole} agent may submit this stage` } };
  }
  const actorId = current.mode === "fixture" && input.actor.actorType === "user" && typeof body.simulatedActorId === "string" ? body.simulatedActorId : input.actor.actorId;
  const command = { kind: input.routeKey, payload: body, actorId, at: new Date().toISOString() } as MissionCommand;
  if (command.kind === "context") validateContext(body);
  const changed = await store.change(companyId, missionId, mission => applyCommand(mission, command));
  return { body: await ensurePhaseIssue(ctx, changed) };
}

const plugin = definePlugin({
  async setup(ctx) { context = ctx; },
  async onApiRequest(input) {
    try { return await run(input); }
    catch (error) { return { status: 422, body: { error: error instanceof Error ? error.message : String(error) } }; }
  },
  async onHealth() { return { status: context ? "ok" : "degraded", message: context ? "PR review worker ready" : "Worker not initialized" }; }
});
export default plugin;
runWorker(plugin, import.meta.url);
