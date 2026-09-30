import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext, PluginApiRequestInput } from "@paperclipai/plugin-sdk";
import { applyCommand, createMission, type Mission } from "../src/workflow.js";
import manifest from "../src/manifest.js";

vi.mock("@paperclipai/plugin-sdk", async importOriginal => ({ ...await importOriginal<typeof import("@paperclipai/plugin-sdk")>(), runWorker: vi.fn() }));
import plugin from "../src/worker.js";

const companyId = "company";
let state: Mission;
let phaseIssues: Array<{ id: string; companyId: string; originKind: string; originId: string; status: string }>;
const originKind = `plugin:${manifest.id}:phase`;
const receipt = () => ({ companyId, repository: state.repository, prNumber: state.prNumber, merged: true, mergedAt: "2026-09-01T00:00:00Z", mergeCommitSha: "c".repeat(40), observedAt: new Date().toISOString(), sourceRef: "https://api.github.com/repos/fixture/repo/pulls/123" });
const issues = {
  list: vi.fn(async (input: { originKind: string; originId: string }) => phaseIssues.filter(i => i.originKind === input.originKind && i.originId === input.originId)),
  get: vi.fn(async (id: string) => phaseIssues.find(i => i.id === id) ?? null),
  update: vi.fn(async (id: string, patch: { status: string }) => Object.assign(phaseIssues.find(i => i.id === id)!, patch)),
  create: vi.fn(async (input: Omit<(typeof phaseIssues)[number], "id">) => {
    const created = { ...input, id: `created-${phaseIssues.length}` };
    phaseIssues.push(created); return created;
  })
};
const managedSkillGet = vi.fn();
const managedSkillReset = vi.fn();
const ctx = {
  db: {
    namespace: "fixture",
    query: async () => [{ state: structuredClone(state), version: state.version }],
    execute: async (_sql: string, params: unknown[]) => {
      if (_sql.startsWith("INSERT")) return { rowCount: 0 };
      if (params[3] !== state.version) return { rowCount: 0 };
      state = JSON.parse(params[0] as string); return { rowCount: 1 };
    }
  },
  issues,
  skills: { managed: { get: managedSkillGet, reset: managedSkillReset } },
  routines: { managed: { get: async () => ({ routineId: "routine" }) } },
  agents: { managed: { get: async (role: string) => ({ agentId: role, agent: { status: "idle" } }) } },
  projects: { managed: { get: async () => ({ projectId: "project" }) } }
} as unknown as PluginContext;
async function request(routeKey: string, body: Record<string, unknown>, agentId = "coordinator") {
  return await plugin.definition.onApiRequest!({ routeKey, companyId, params: { missionId: state.id }, body, actor: { actorType: "agent", actorId: agentId, agentId } } as unknown as PluginApiRequestInput) as { status?: number; body: Mission & { error?: string } };
}

beforeEach(async () => {
  vi.clearAllMocks();
  state = createMission({ id: "mission", companyId, repository: "fixture/repo", prNumber: 123 });
  state.pendingIssue = null;
  state.issueIds = { context: "active", review: "finished" };
  phaseIssues = [
    { id: "active", companyId, originKind, originId: `${state.id}:context`, status: "in_progress" },
    { id: "finished", companyId, originKind, originId: `${state.id}:review`, status: "done" },
    { id: "other", companyId, originKind, originId: "other-mission:context", status: "todo" }
  ];
  await plugin.definition.setup!(ctx);
});

describe("merge closure worker with simulated host", () => {
  it("exposes an authorized route, cancels only unfinished owned phases, and makes retries inert", async () => {
    expect(manifest.apiRoutes).toContainEqual(expect.objectContaining({ routeKey: "close", auth: "board-or-agent" }));
    expect(manifest.capabilities).toContain("issues.update");
    const body = receipt();
    const result = await request("close", body);
    expect(result.body.stage).toBe("merged_externally");
    expect(result.body.closure?.issuesReconciled).toBe(true);
    expect(phaseIssues.map(i => i.status)).toEqual(["cancelled", "done", "todo"]);
    const version = state.version;
    await request("close", body);
    expect(state.version).toBe(version);
    expect(issues.update).toHaveBeenCalledTimes(1);
    expect(issues.create).not.toHaveBeenCalled();
    for (const route of ["resume", "invalidate", "evidence"]) expect((await request(route, {})).status).toBe(422);
    expect(issues.create).not.toHaveBeenCalled();
  });
  it.each(["reviewer", "fixer", "unrelated"])("refuses closure by %s", async agentId => {
    expect((await request("close", receipt(), agentId)).status).toBe(403);
    expect(state.stage).toBe("context");
    expect(issues.update).not.toHaveBeenCalled();
  });
  it("keeps the mission terminal after host failure and retries cleanup without a new closure", async () => {
    const body = receipt();
    issues.update.mockRejectedValueOnce(new Error("host unavailable"));
    expect((await request("close", body)).status).toBe(422);
    expect(state.stage).toBe("merged_externally");
    expect(state.closure?.issuesReconciled).toBe(false);
    const originalClosure = structuredClone(state.closure);
    const result = await request("close", body);
    expect(result.body.closure).toEqual({ ...originalClosure, issuesReconciled: true });
  });
  it("recovers an unrecorded phase issue by the pending origin after a dispatch interruption", async () => {
    state.pendingIssue = { key: "orphan", role: "reviewer", description: "review", leaseUntil: "2026-01-01T00:00:00Z" };
    phaseIssues.push({ id: "orphan", companyId, originKind, originId: `${state.id}:orphan`, status: "todo" });
    const result = await request("close", receipt());
    expect(result.body.closure?.issuesReconciled).toBe(true);
    expect(phaseIssues.find(i => i.id === "orphan")?.status).toBe("cancelled");
  });
  it.each([-60_000, 60_000])("leaves an unresolved dispatch pending regardless of lease age %s", async offset => {
    state.pendingIssue = { key: "in-flight", role: "reviewer", description: "review", leaseUntil: new Date(Date.now() + offset).toISOString() };
    const result = await request("close", receipt());
    expect(result.body.closure?.issuesReconciled).toBe(false);
    expect(result.body.stage).toBe("merged_externally");
  });
  it("cancels an issue created while a concurrent close wins the ledger update", async () => {
    state.stage = "waiting_external";
    issues.create.mockImplementationOnce(async input => {
      state = applyCommand(state, { kind: "close", payload: receipt(), actorId: "coordinator", at: new Date().toISOString() });
      state.version++;
      const created = { ...input, id: "racing-issue" };
      phaseIssues.push(created); return created;
    });
    const result = await request("resume", {});
    expect(result.body.stage).toBe("merged_externally");
    expect(state.pendingIssue).toBeNull();
    expect(phaseIssues.find(i => i.id === "racing-issue")?.status).toBe("cancelled");
    expect(Object.values(state.issueIds)).toContain("racing-issue");
  });
});


describe("review regressions", () => {
  it("does not mark a newer dispatch snapshot reconciled after a stale scan", async () => {
    const originalList = async (input: { originKind: string; originId: string }) => phaseIssues.filter(i => i.originKind === input.originKind && i.originId === input.originId);
    issues.list.mockImplementationOnce(originalList).mockImplementationOnce(async input => {
      const result = await originalList(input);
      phaseIssues.push({ id: "late", companyId, originKind, originId: `${state.id}:late`, status: "todo" });
      state = { ...state, version: state.version + 1, issueIds: { ...state.issueIds, late: "late" }, closure: { ...state.closure!, issuesReconciled: false } };
      return result;
    });
    const body = receipt();
    expect((await request("close", body)).body.closure?.issuesReconciled).toBe(false);
    expect(phaseIssues.find(i => i.id === "late")?.status).toBe("todo");
    expect((await request("close", body)).body.closure?.issuesReconciled).toBe(true);
    expect(phaseIssues.find(i => i.id === "late")?.status).toBe("cancelled");
  });
  it.each([null, { reason: "customized" }])("never replaces skill content through a non-atomic reset: %j", async drift => {
    const markdown = "reviewed content";
    const hash = createHash("sha256").update(markdown).digest("hex");
    managedSkillGet.mockResolvedValue({ skillId: "skill", skill: { markdown, fileInventory: [{ path: "SKILL.md" }] }, defaultDrift: drift });
    const result = await request("skill-default", { companyId, skillKey: "pr-review-workflow", expectedSkillId: "skill", expectedCurrentHash: hash });
    if (drift) { expect(result.status).toBe(422); expect(result.body.error).toMatch(/Atomic.*unsupported/); }
    else expect(result.body).toMatchObject({ changed: false, currentHash: hash });
    expect(managedSkillReset).not.toHaveBeenCalled();
  });
});


it("never takes over an expired dispatch and recovers its positively observed issue", async () => {
  state.pendingIssue = { key: "uncertain", role: "coordinator", description: "context", leaseOwner: "old-owner", leaseUntil: "2026-01-01T00:00:00Z" };
  const start = { repository: state.repository, prNumber: state.prNumber, mode: "fixture" };
  const unknown = await request("start", start);
  expect(unknown.body.pendingIssue?.leaseOwner).toBe("old-owner");
  expect(issues.create).not.toHaveBeenCalled();
  phaseIssues.push({ id: "recovered", companyId, originKind, originId: `${state.id}:uncertain`, status: "todo" });
  const recovered = await request("start", start);
  expect(recovered.body.pendingIssue).toBeNull();
  expect(recovered.body.issueIds.uncertain).toBe("recovered");
  expect(issues.create).not.toHaveBeenCalled();
});
