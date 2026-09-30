import { describe, expect, it } from "vitest";
import { applyCommand, createMission, type Mission, type Stage } from "../src/workflow.js";

const at = "2026-09-30T04:00:00Z";
const receipt = { repository: "fixture/repo", prNumber: 123, merged: true, mergedAt: "2026-09-30T03:00:00Z", mergeCommitSha: "c".repeat(40), observedAt: at, sourceRef: "https://api.github.com/repos/fixture/repo/pulls/123" };
const mission = () => createMission({ id: "m", companyId: "c", repository: receipt.repository, prNumber: receipt.prNumber });
const close = (m: Mission, payload: Record<string, unknown> = receipt, time = at) => applyCommand(m, { kind: "close", payload, actorId: "coordinator", at: time });

describe("external merge closure", () => {
  it.each<Stage>(["context", "initial_review", "correction_intent", "correction", "final_review", "readiness", "waiting_external", "needs_intervention", "budget_exhausted", "verified_mergeable"])("closes from %s without requiring readiness or a remaining budget", stage => {
    const m = mission();
    m.stage = stage;
    m.headSha = "b".repeat(40); m.baseSha = "a".repeat(40);
    m.budgets.correctionsReserved = m.budgets.maxCorrections;
    m.budgets.resumesReserved = m.budgets.maxResumes;
    m.findings.push({ id: "f", cause: "bad input", invariant: "valid input", severity: "high", path: "input.ts", line: 1, evidence: "fixture", impact: "invalid data accepted", status: "open", reason: "", observations: [], correctionRefs: [], verificationRefs: [] });
    m.effects.push = { kind: "push", state: "reserved", at };
    m.verdict = { state: "waiting_external", reasons: ["checks unknown"], headSha: m.headSha, baseSha: m.baseSha, at, sourceRefs: ["fixture:checks"] };
    const before = structuredClone(m);
    const result = close(m);
    expect(result.stage).toBe("merged_externally");
    expect(result.pendingIssue).toBeNull();
    expect(result.closure).toMatchObject({ previousStage: stage, mergeCommitSha: receipt.mergeCommitSha, actorId: "coordinator", issuesReconciled: false });
    for (const key of ["headSha", "baseSha", "context", "findings", "effects", "budgets", "verdict", "review", "correctionIntent", "issueIds"] as const) expect(result[key]).toEqual(before[key]);
    expect(m).toEqual(before);
  });
  it.each([
    { merged: false }, { merged: "true" }, { merged: undefined },
    { repository: "fixture/other" }, { prNumber: 456 }, { prNumber: "123" },
    { mergedAt: "2026-02-30T00:00:00Z" }, { mergedAt: "2026-09-30T04:01:00Z" },
    { observedAt: "2026-09-30T03:49:59Z" }, { observedAt: "2026-09-30T04:01:01Z" },
    { observedAt: "2026-09-30T04:00:00+00:00" }, { sourceRef: " " }, { mergeCommitSha: "unknown" }
  ])("rejects incomplete, mismatched or stale evidence: %j", override => {
    expect(() => close(mission(), { ...receipt, ...override })).toThrow();
  });
  it("retains the original closure on delayed retries and rejects conflicting receipts", () => {
    const m = close(mission());
    expect(close(m, receipt, "2026-10-01T00:00:00Z")).toBe(m);
    expect(close(m, { ...receipt, observedAt: "2026-10-01T00:00:00Z" }, "2026-10-01T00:00:00Z")).toBe(m);
    expect(() => close(m, { ...receipt, mergeCommitSha: "d".repeat(40) })).toThrow(/Conflicting/);
    expect(() => close(m, { ...receipt, mergedAt: "2026-09-30T02:00:00Z" })).toThrow(/Conflicting/);
  });
  it.each(["resume", "invalidate", "context", "review", "decision", "intent", "correction", "evidence", "effect"])("rejects late %s commands", kind => {
    const m = close(mission());
    expect(() => applyCommand(m, { kind, payload: {}, actorId: "late-agent", at })).toThrow(/closed/);
  });
  it("survives JSON persistence and preserves a pending dispatch origin for recovery", () => {
    const m = mission();
    m.pendingIssue!.leaseUntil = "2026-09-30T04:00:30Z";
    const result = JSON.parse(JSON.stringify(close(m))) as Mission;
    expect(result.closure).toMatchObject({ pendingIssueKey: "context-0", dispatchPending: true });
    expect(close(result)).toBe(result);
  });
});
