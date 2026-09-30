#!/usr/bin/env node
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { roleSkillKeys } from "./skill-bindings.mjs";

const pluginPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginKey = "ty000.plugin-pr-review";
const args = process.argv.slice(2);
const command = args.shift();
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!args[i]?.startsWith("--") || !args[i + 1]) throw new Error(`Expected --option value, got ${args[i] ?? "end of arguments"}`);
  options[args[i].slice(2)] = args[i + 1];
}
const required = (key) => { if (!options[key]) throw new Error(`--${key} is required`); return options[key]; };
const api = (options.api ?? process.env.PAPERCLIP_API_URL ?? "").replace(/\/$/, "").replace(/\/api$/, "");
const companyId = options.company ?? process.env.PAPERCLIP_COMPANY_ID;
const token = process.env.PAPERCLIP_API_KEY;
async function request(method, route, body) {
  const response = await fetch(`${api}${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const raw = await response.text(); let result;
  try { result = raw ? JSON.parse(raw) : null; } catch { result = raw; }
  if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status}: ${typeof result === "object" ? JSON.stringify(result) : result}`);
  return result;
}
const route = (suffix) => `/api/plugins/${pluginKey}/api${suffix}`;
const show = (value) => console.log(JSON.stringify(value, null, 2));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const selectedSkillState = (entry) => ["configured", "installed"].includes(entry.state);
async function target() {
  if (!api) throw new Error("--api is required");
  if (!companyId) throw new Error("--company is required");
  const [health, company] = await Promise.all([request("GET", "/api/health"), request("GET", `/api/companies/${companyId}`)]);
  if (health.status !== "ok" || company.id !== companyId) throw new Error("Paperclip target or company is not ready");
  if (options.commit && health.commit !== options.commit) throw new Error(`Host commit ${health.commit} differs from --commit ${options.commit}`);
  return { api, companyId, companyName: company.name, hostVersion: health.version, hostCommit: health.commit, deploymentMode: health.deploymentMode, instance: options.instance ?? "operator asserted; host API does not expose instance ID" };
}
async function pluginRecord() {
  const plugins = await request("GET", "/api/plugins");
  return Array.isArray(plugins) ? plugins.find(p => p.pluginKey === pluginKey) : null;
}
async function resources() { return request("GET", route(`/resources?companyId=${encodeURIComponent(companyId)}`)); }
async function workspaceStatus(projectId, expected) {
  const workspaces = await request("GET", `/api/projects/${projectId}/workspaces`);
  const primary = workspaces.find(w => w.isPrimary) ?? null;
  const match = expected && workspaces.find(w => w.cwd === expected || w.repoUrl === expected) || null;
  return { workspaces, primary, match };
}
async function skillAssignmentPlan(installed) {
  const result = {};
  for (const [role, skillKeys] of Object.entries(roleSkillKeys)) {
    const agent = installed.agents?.[role];
    if (!agent?.agentId) throw new Error(`Managed ${role} agent is missing`);
    const drift = skillKeys.filter(key => installed.skills?.[key]?.defaultDrift);
    const required = skillKeys.map(key => {
      const skill = installed.skills?.[key];
      if (!skill?.skillId || typeof skill.skill?.key !== "string") throw new Error(`Managed skill ${key} is not installed; run update/setup before selecting skills`);
      return skill.skill.key;
    });
    const snapshot = await request("GET", `/api/agents/${agent.agentId}/skills`);
    result[role] = { agentId: agent.agentId, status: agent.agent?.status, required, drift, desired: snapshot.desiredSkills ?? [], missing: required.filter(key => !snapshot.desiredSkills?.includes(key)), supported: snapshot.supported, mode: snapshot.mode, warnings: snapshot.warnings ?? [], states: required.map(key => ({ key, state: snapshot.entries?.find(entry => entry.key === key)?.state ?? "unknown" })) };
  }
  return result;
}
function managedSkillSummaries(installed) {
  return Object.fromEntries(Object.entries(installed.skills ?? {}).map(([key, resource]) => [key, { skillId: resource.skillId, currentHash: typeof resource.skill?.markdown === "string" ? sha256(resource.skill.markdown) : null, drift: resource.defaultDrift }]));
}
async function syncSkills() {
  await target();
  const before = await skillAssignmentPlan(await resources());
  if (Object.values(before).some(role => !["idle", "paused"].includes(role.status))) throw new Error("An agent is running or unavailable; wait for a safe cutover before changing desired skills");
  if (Object.values(before).some(role => role.drift.length)) throw new Error("Managed skill content differs from the installed manifest; review and synchronize skill content before changing desired skills");
  if (Object.values(before).some(role => !role.supported)) throw new Error("An agent adapter does not support skill assignment");
  for (const role of Object.values(before)) {
    if (!role.missing.length && role.states.every(selectedSkillState)) continue;
    // An empty add retries adapter materialization without changing saved keys or pins.
    await request("POST", `/api/agents/${role.agentId}/skills/sync`, { mode: "add", desiredSkills: role.missing });
    const current = await request("GET", `/api/agents/${role.agentId}/skills`);
    if (role.missing.some(key => !current.desiredSkills?.includes(key))) throw new Error(`Skill selection for ${role.agentId} did not persist; inspect current state before retrying`);
  }
  const after = await skillAssignmentPlan(await resources());
  if (Object.values(after).some(role => role.missing.length || role.states.some(entry => !selectedSkillState(entry)))) throw new Error("Skill selection is partial or stale; inspect agent skills before activating");
  return { before, after };
}
async function plan() {
  const identity = await target();
  const plugin = await pluginRecord();
  const installed = plugin?.status === "ready" ? await resources() : null;
  const workspace = installed?.project?.projectId ? await workspaceStatus(installed.project.projectId, options.workspace) : null;
  const missions = installed ? await request("GET", route(`/missions?companyId=${encodeURIComponent(companyId)}`)) : [];
  const triggers = installed?.routine?.routineId ? (await request("GET", `/api/routines/${installed.routine.routineId}`)).triggers ?? [] : [];
  const pluginHealth = plugin?.status === "ready" ? await request("GET", `/api/plugins/${plugin.id}/health`).catch(() => null) : null;
  const localPackage = JSON.parse(await fs.readFile(path.join(pluginPath, "package.json"), "utf8"));
  const agentValues = Object.values(installed?.agents ?? {});
  const skillsInstalled = Object.keys(installed?.skills ?? {}).length === 4 && Object.values(installed.skills).every(skill => skill.skillId);
  const assignment = skillsInstalled ? await skillAssignmentPlan(installed) : null;
  const skillsSelected = Boolean(assignment && Object.values(assignment).every(role => role.supported && !role.missing.length && !role.drift.length && role.states.every(selectedSkillState)));
  return { target: identity, plugin: plugin ? { id: plugin.id, version: plugin.version, status: plugin.status, lastError: plugin.lastError } : null,
    resources: installed ? { projectId: installed.project.projectId, skills: managedSkillSummaries(installed), routineId: installed.routine.routineId, agents: Object.fromEntries(Object.entries(installed.agents).map(([k,v]) => [k, { id: v.agentId, adapterType: v.agent?.adapterType, model: v.agent?.adapterConfig?.model ?? null, status: v.agent?.status, drift: v.defaultDrift }])) } : null,
    workspace: workspace && { primary: workspace.primary, requestedMatch: workspace.match },
    lifecycle: { packageBuilt: Boolean(await fs.stat(path.join(pluginPath, "dist/worker.js")).catch(() => null)), installed: Boolean(plugin), loaded: plugin?.status === "ready" && pluginHealth?.status === "ready" && pluginHealth?.healthy === true, resourcesInstalled: Boolean(installed?.project?.projectId && skillsInstalled && installed?.routine?.routineId && agentValues.length === 3 && agentValues.every(a => a.agentId)), configured: Boolean(workspace?.primary && agentValues.length === 3 && agentValues.every(a => a.agent?.adapterType !== "process" && typeof a.agent?.adapterConfig?.model === "string")), skillsSelected, activated: Boolean(skillsSelected && agentValues.length === 3 && agentValues.every(a => a.agent?.status === "idle") && installed?.routine?.routine?.status === "active" && triggers.some(t => t.kind === "schedule" && t.enabled)), realReviewExecuted: missions.some(m => m.mode === "github" && m.review), fixtureReviewExecuted: missions.some(m => m.mode === "fixture" && m.review) },
    sourceVersion: localPackage.version,
    action: !plugin ? "install-plugin" : plugin.status !== "ready" ? "repair-plugin" : plugin.version !== localPackage.version ? "upgrade-plugin" : !installed?.project?.projectId || !skillsInstalled ? "reconcile-resources" : !workspace?.primary || options.workspace && !workspace.match ? "bind-workspace" : "none" };
}
async function install(update = false) {
  const before = await plan();
  const portable = options.from ? JSON.parse(await fs.readFile(options.from, "utf8")) : null;
  if (portable && (portable.schemaVersion !== 1 || portable.product !== pluginKey || portable.version !== before.sourceVersion)) throw new Error("Portable config product/schema/version mismatch");
  if (before.plugin && before.plugin.status !== "ready" && !update) throw new Error("Existing plugin is not ready; use update after inspecting the error");
  if (!before.plugin) {
    const plugin = await request("POST", "/api/plugins/install", { packageName: pluginPath, isLocalPath: true });
    if (plugin.status !== "ready") throw new Error(`Plugin installed but status is ${plugin.status}: ${plugin.lastError ?? "unknown"}`);
  } else if (update && before.plugin.version !== before.sourceVersion) {
    const upgraded = await request("POST", `/api/plugins/${before.plugin.id}/upgrade`, { version: before.sourceVersion });
    if (upgraded.status !== "ready") throw new Error(`Upgrade requires operator action: ${upgraded.status}: ${upgraded.lastError ?? ""}`);
  }
  const result = await request("POST", route("/setup"), { companyId });
  if (!result.project?.projectId || Object.keys(result.skills ?? {}).length !== 4 || Object.values(result.skills).some(s => !s.skillId) || !result.routine?.routineId || Object.values(result.agents ?? {}).some(a => !a.agentId)) throw new Error("Resource reconcile was incomplete");
  if (options.workspace) {
    const expected = options.workspace;
    const status = await workspaceStatus(result.project.projectId, expected);
    if (status.primary && !status.match) throw new Error(`Workspace divergence: primary ${status.primary.cwd ?? status.primary.repoUrl} differs from ${expected}; no overwrite performed`);
    if (!status.match) {
      const input = /^https:\/\//.test(expected) ? { name: "PR review repository", sourceType: "git_repo", repoUrl: expected, isPrimary: true } : { name: "PR review repository", sourceType: "local_path", cwd: path.resolve(expected), isPrimary: true };
      if (input.cwd) await fs.access(input.cwd);
      await request("POST", `/api/projects/${result.project.projectId}/workspaces`, input);
    }
  }
  if (portable?.adapters) {
    for (const [role, selection] of Object.entries(portable.adapters)) {
      if (!selection || typeof selection !== "object" || typeof selection.type !== "string" || typeof selection.model !== "string") throw new Error(`Portable adapter ${role} requires type and model`);
      await configureSelection(selection.type, selection.model, [role]);
    }
  }
  return { before, after: await plan() };
}
async function activate() {
  await target();
  if (options["bindings-verified"] !== "true") throw new Error("Activation requires --bindings-verified true after Paperclip adapter and credential checks");
  const r = await resources();
  if (!r.project?.projectId) throw new Error("Project missing");
  const ws = await workspaceStatus(r.project.projectId);
  if (!ws.primary) throw new Error("Primary workspace binding missing");
  const agents = Object.values(r.agents ?? {});
  if (agents.length !== 3 || agents.some(a => !a.agentId || !a.agent || a.agent.adapterType === "process")) throw new Error("Configure a runnable adapter and model/credentials for all three agents before activation");
  const skillPlan = await skillAssignmentPlan(r);
  if (Object.values(skillPlan).some(role => role.missing.length || role.drift.length || !role.supported || role.states.some(entry => !selectedSkillState(entry)))) throw new Error("Synchronize managed skill content and select role skills before activating agents");
  for (const agent of agents) if (agent.agent.status === "paused") await request("POST", `/api/agents/${agent.agentId}/resume`, {});
  const routine = await request("PATCH", `/api/routines/${r.routine.routineId}`, { status: "active" });
  const triggers = (await request("GET", `/api/routines/${r.routine.routineId}`)).triggers ?? [];
  for (const trigger of triggers) if (trigger.kind === "schedule" && !trigger.enabled) await request("PATCH", `/api/routine-triggers/${trigger.id}`, { enabled: true });
  return { agents: (await resources()).agents, routine, triggers: (await request("GET", `/api/routines/${r.routine.routineId}`)).triggers ?? [] };
}
async function configureSelection(adapter, model, roles) {
  await target();
  const inventory = await request("GET", "/api/adapters");
  const match = inventory.find(a => a.type === adapter && a.loaded && !a.disabled);
  if (!match) throw new Error(`Adapter ${adapter} is unavailable or disabled on this host`);
  const models = await request("GET", `/api/companies/${companyId}/adapters/${adapter}/models`);
  if (!models.some(m => m.id === model)) throw new Error(`Model ${model} is not offered by adapter ${adapter} on this host`);
  const r = await resources();
  if (roles.some(role => !["coordinator", "reviewer", "fixer"].includes(role))) throw new Error("Unknown role in --roles");
  const results = {};
  for (const role of roles) {
    const agent = r.agents[role];
    if (!agent?.agentId) throw new Error(`Managed agent ${role} is missing`);
    results[role] = await request("PATCH", `/api/agents/${agent.agentId}`, { adapterType: adapter, adapterConfig: { model } });
  }
  return Object.fromEntries(Object.entries(results).map(([role, agent]) => [role, { id: agent.id, adapterType: agent.adapterType, model: agent.adapterConfig?.model, status: agent.status }]));
}
async function configure() { return configureSelection(required("adapter"), required("model"), options.roles ? options.roles.split(",").map(s => s.trim()) : ["coordinator", "reviewer", "fixer"]); }
async function portableExport() {
  const p = await plan();
  if (!p.plugin || !p.resources) throw new Error("Install before exporting");
  const data = { schemaVersion: 1, product: pluginKey, version: p.plugin.version, paperclip: { version: p.target.hostVersion, commit: p.target.hostCommit }, resources: { agentKeys: ["coordinator", "reviewer", "fixer"], projectKey: "pr-review", routineKey: "resume-missions", skillKeys: Object.keys(p.resources.skills) }, adapters: Object.fromEntries(Object.entries(p.resources.agents).map(([k,v]) => [k, { type: v.adapterType, model: v.model }])), workspace: p.workspace?.primary?.repoUrl ? { repoUrl: p.workspace.primary.repoUrl } : { inputRequired: "workspace path or repository URL" }, excluded: ["credentials", "secret references", "local paths", "company and instance IDs", "issues", "mission state", "run history"] };
  if (options.out) await fs.writeFile(options.out, JSON.stringify(data, null, 2) + "\n");
  return data;
}

try {
  if (!["plan", "install", "status", "update", "configure", "skills-plan", "sync-skills", "activate", "export", "diff", "start", "resume"].includes(command)) throw new Error("Usage: pr-review <plan|install|status|update|configure|skills-plan|sync-skills|activate|export|diff|start|resume> --api URL --company ID [--workspace PATH|URL] [--instance NAME]");
  if (command === "plan" || command === "status") show(await plan());
  else if (command === "install" || command === "update") show(await install(command === "update"));
  else if (command === "activate") show(await activate());
  else if (command === "configure") show(await configure());
  else if (command === "skills-plan") { await target(); const installed = await resources(); show({ skills: managedSkillSummaries(installed), agents: await skillAssignmentPlan(installed) }); }
  else if (command === "sync-skills") show(await syncSkills());
  else if (command === "export") show(await portableExport());
  else if (command === "diff") {
    const actual = await portableExport(); const source = JSON.parse(await fs.readFile(required("from"), "utf8"));
    show({ equal: JSON.stringify(actual) === JSON.stringify(source), source, actual });
  } else if (command === "start") {
    await target(); show(await request("POST", route("/missions"), { companyId, repository: required("repository"), prNumber: Number(required("pr")), mode: options.mode ?? "github", rights: { modify: options["allow-modify"] === "true", push: options["allow-push"] === "true", comment: options["allow-comment"] === "true", resolveThreads: options["allow-resolve-threads"] === "true" }, maxCorrections: options["max-corrections"] ? Number(options["max-corrections"]) : undefined, maxResumes: options["max-resumes"] ? Number(options["max-resumes"]) : undefined }));
  } else if (command === "resume") {
    await target(); show(await request("POST", route(`/missions/${required("mission")}/resume`), { companyId }));
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
