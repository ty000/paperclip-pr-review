import { describe, expect, it } from "vitest";
import { applyCommand, createMission, evaluateReadiness, validateContext, type ReadinessEvidence } from "../src/workflow.js";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const context = () => ({ schemaVersion: 1, repository: "fixture/repo", prNumber: 1, baseSha: A, headSha: B, objective: "Add correctly", scope: ["math.js"], acceptanceCriteria: [{ criterion: "Returns a+b", sourceRef: "issue:1" }], files: ["math.js"], behaviors: ["addition"], exclusions: [], risks: [{ risk: "wrong operator", evidence: "diff:math.js:1" }], decisions: [], previousFindings: [], changesSincePrevious: [], tests: [], ci: [], unknowns: [], coverageLimits: [], sourceRefs: ["issue:1"] });
const command = (kind: string, payload: Record<string, unknown>, actorId = "reviewer") => ({ kind, payload, actorId, at: "2026-09-29T00:00:00Z" });

describe("mission contract", () => {
  it("pins and hashes context, rejects stale reviews", () => {
    let m = createMission({ id: "m", companyId: "c", repository: "fixture/repo", prNumber: 1, mode: "fixture" });
    m = applyCommand(m, command("context", context(), "coordinator"));
    expect(m.context?.hash).toEqual(validateContext(context()).hash);
    expect(() => applyCommand(m, command("review", { headSha: A, contextHash: m.context!.hash, phase: "initial", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [] }))).toThrow(/Stale/);
  });
  it("deduplicates one cause and preserves correction budget", () => {
    let m = createMission({ id: "m", companyId: "c", repository: "fixture/repo", prNumber: 1, mode: "fixture", maxCorrections: 1 });
    m = applyCommand(m, command("context", context()));
    const finding = { cause: "subtraction", invariant: "addition", severity: "high", path: "math.js", line: 1, evidence: "returns a-b", impact: "wrong result" };
    m = applyCommand(m, command("review", { headSha: B, contextHash: m.context!.hash, phase: "initial", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [finding, finding] }));
    expect(m.findings).toHaveLength(1);
    expect(m.findings[0].observations).toHaveLength(2);
    m = applyCommand(m, command("intent", { findingIds: [m.findings[0].id], defect: "wrong op", change: "use +", expectedProof: "test" }, "fixer"));
    expect(m.budgets.correctionsReserved).toBe(1);
    expect(m.budgets.correctionsConfirmed).toBe(0);
    expect(() => applyCommand(m, command("intent", { findingIds: [m.findings[0].id], defect: "x", change: "y", expectedProof: "z" }))).toThrow();
  });
  it("fails closed on every incomplete readiness dimension", () => {
    let m = createMission({ id: "m", companyId: "c", repository: "fixture/repo", prNumber: 1, mode: "fixture" });
    m = applyCommand(m, command("context", context()));
    m = applyCommand(m, command("review", { headSha: B, contextHash: m.context!.hash, phase: "initial", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [] }));
    m = applyCommand(m, command("review", { headSha: B, contextHash: m.context!.hash, phase: "final", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [] }));
    const good: ReadinessEvidence = { headSha: B, baseSha: A, remoteHeadSha: B, currentBaseSha: A, observedAt: "2026-09-29T00:00:00Z", sourceRefs: ["fixture:status"], conflict: false, checks: [{ name: "test", conclusion: "success", required: true, applicable: true, sourceRef: "fixture:check" }], jobs: [], approvals: { satisfied: true, sourceRef: "fixture:approval" }, conversations: { resolved: true, sourceRef: "fixture:threads" }, rules: { satisfied: true, allowsSkipped: false, allowsNeutral: false, sourceRef: "fixture:rules" }, tests: [{ name: "test", passed: true, sourceRef: "fixture:test" }] };
    const assess = (mission: typeof m, evidence: typeof good) => evaluateReadiness(mission, evidence, "2026-09-29T00:00:00Z");
    expect(assess(m, good)).toEqual([]);
    expect(assess(m, { ...good, checks: [{ ...good.checks[0], conclusion: "failure" }] })).not.toEqual([]);
    expect(assess(m, { ...good, checks: [{ ...good.checks[0], conclusion: "pending" }] })).not.toEqual([]);
    expect(assess(m, { ...good, conflict: true })).not.toEqual([]);
    expect(assess(m, { ...good, approvals: { ...good.approvals, satisfied: false } })).not.toEqual([]);
    expect(assess(m, { ...good, jobs: [{ name: "red", conclusion: "failure", explained: false, sourceRef: "fixture:job" }] })).not.toEqual([]);
    expect(assess({ ...m, review: { ...m.review!, coverage: { ...m.review!.coverage, complete: false } } }, good)).toContain("final independent review coverage incomplete");
    expect(assess({ ...m, findings: [{ id: "f", cause: "wrong operator", invariant: "sum", severity: "high", path: "math.js", line: 1, evidence: "fixture", impact: "wrong result", status: "open", reason: "", observations: [], correctionRefs: [], verificationRefs: [] }] }, good)).toContain("actionable or serious finding unresolved");
    expect(assess(m, { ...good, observedAt: "2026-09-28T23:49:59Z" })).toContain("readiness evidence stale or future-dated");
    expect(assess(m, { ...good, observedAt: "2026-09-29T00:01:01Z" })).toContain("readiness evidence stale or future-dated");
    for (const bad of [
      { ...good, checks: [{ ...good.checks[0], required: "false" }] },
      { ...good, checks: [{ ...good.checks[0], conclusion: "timed_out" }] },
      { ...good, jobs: [{ name: "red", conclusion: "failure", explained: "true", sourceRef: "fixture:job" }] },
      { ...good, tests: [{ name: "test", passed: "true", sourceRef: "fixture:test" }] },
      { ...good, rules: { ...good.rules, allowsSkipped: "false" } },
      { ...good, approvals: { satisfied: "true", sourceRef: "fixture:approval" } },
      { ...good, observedAt: "2026-02-30T00:00:00Z" }
    ]) {
      expect(evaluateReadiness(m, bad as typeof good, "2026-09-29T00:00:00Z")).toContain("readiness evidence malformed");
      expect(() => applyCommand(m, command("evidence", bad as Record<string, unknown>, "coordinator"))).toThrow();
    }
  });
  it("reopens every reobserved finding with its current severity and evidence", () => {
    let m = createMission({ id: "m", companyId: "c", repository: "fixture/repo", prNumber: 1, mode: "fixture" });
    m = applyCommand(m, command("context", context()));
    const finding = { cause: "wrong operator", invariant: "sum", severity: "medium", path: "math.js", line: 1, evidence: "old evidence", impact: "wrong result" };
    m = applyCommand(m, command("review", { headSha: B, contextHash: m.context!.hash, phase: "initial", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [finding] }));
    const initialFixerKey = m.pendingIssue!.key;
    m = applyCommand(m, command("decision", { findingId: m.findings[0].id, status: "rejected", reason: "old decision" }));
    m = applyCommand(m, command("review", { headSha: B, contextHash: m.context!.hash, phase: "final", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [{ ...finding, severity: "critical", evidence: "new evidence", line: 2 }] }));
    expect(m.stage).toBe("correction_intent");
    expect(m.pendingIssue!.key).not.toBe(initialFixerKey);
    expect(m.findings).toHaveLength(1);
    expect(m.findings[0]).toMatchObject({ status: "open", severity: "critical", evidence: "new evidence", line: 2 });
    expect(m.findings[0].observations).toHaveLength(2);
  });
  it("rejects duplicate cycles and severity downgrades", () => {
    let m = createMission({ id: "m", companyId: "c", repository: "fixture/repo", prNumber: 1, mode: "fixture" });
    m = applyCommand(m, command("context", context()));
    m = applyCommand(m, command("review", { headSha: B, contextHash: m.context!.hash, phase: "initial", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [
      { cause: "first", invariant: "sum", severity: "high", path: "math.js", line: 1, evidence: "one", impact: "wrong result" },
      { cause: "second", invariant: "sum", severity: "low", path: "math.js", line: 2, evidence: "two", impact: "wrong result" }
    ] }));
    const [first, second] = m.findings;
    expect(() => applyCommand(m, command("decision", { findingId: first.id, status: "duplicate", duplicateOf: second.id, reason: "same" }))).toThrow(/lower severity/);
    m = applyCommand(m, command("decision", { findingId: second.id, status: "duplicate", duplicateOf: first.id, reason: "same" }));
    expect(() => applyCommand(m, command("decision", { findingId: first.id, status: "duplicate", duplicateOf: second.id, reason: "same" }))).toThrow(/independent canonical/);
  });
  it("uses the base or context identity in phase issue keys", () => {
    let m = createMission({ id: "m", companyId: "c", repository: "fixture/repo", prNumber: 1, mode: "fixture" });
    m = applyCommand(m, command("context", context()));
    const initialKey = m.pendingIssue!.key;
    m = applyCommand(m, command("invalidate", { headSha: B, baseSha: C, reason: "base moved", sourceRef: "fixture:base" }));
    expect(m.pendingIssue!.key).not.toBe(initialKey);
    const invalidationKey = m.pendingIssue!.key;
    const phaseSequence = m.phaseSequence;
    m = applyCommand(m, command("invalidate", { headSha: B, baseSha: C, reason: "base moved", sourceRef: "fixture:base" }));
    expect(m.pendingIssue!.key).toBe(invalidationKey);
    expect(m.phaseSequence).toBe(phaseSequence);
    m = applyCommand(m, command("context", { ...context(), baseSha: C }));
    expect(m.pendingIssue!.key).not.toBe(initialKey);
  });
  it("consumes a reserved resume effect without reserving the budget twice", () => {
    let m = createMission({ id: "m", companyId: "c", repository: "fixture/repo", prNumber: 1, mode: "fixture", maxResumes: 1 });
    m = applyCommand(m, command("context", context()));
    m = applyCommand(m, command("review", { headSha: B, contextHash: m.context!.hash, phase: "initial", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [] }));
    m = applyCommand(m, command("review", { headSha: B, contextHash: m.context!.hash, phase: "final", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [] }));
    m = applyCommand(m, command("evidence", { headSha: B, baseSha: A, remoteHeadSha: B, currentBaseSha: A, observedAt: "2026-09-29T00:00:00Z", sourceRefs: ["fixture"], conflict: null, checks: [], jobs: [], approvals: { satisfied: null, sourceRef: "fixture" }, conversations: { resolved: null, sourceRef: "fixture" }, rules: { satisfied: null, allowsSkipped: false, allowsNeutral: false, sourceRef: "fixture" }, tests: [] }, "coordinator"));
    const legacy = structuredClone(m);
    legacy.effects["old-resume"] = { kind: "resume", state: "confirmed", at: "2026-09-29T00:00:00Z", receipt: "fixture:old" };
    expect(() => applyCommand(legacy, command("resume", {}))).toThrow(/Legacy resume effect/);
    m = applyCommand(m, command("effect", { key: "resume-1", kind: "resume", action: "reserve" }));
    expect(m.budgets.resumesReserved).toBe(1);
    expect(() => applyCommand(m, command("effect", { key: "resume-2", kind: "resume", action: "reserve" }))).toThrow(/already reserved/);
    expect(() => applyCommand(m, command("resume", {}))).toThrow(/reconciliation receipt/);
    m = applyCommand(m, command("effect", { key: "resume-1", kind: "resume", action: "confirm", receipt: "fixture:reconciled" }));
    m = applyCommand(m, command("resume", {}));
    expect(m.stage).toBe("readiness");
    expect(m.budgets.resumesReserved).toBe(1);
    expect(m.budgets.resumesConfirmed).toBe(1);
    expect(m.effects["resume-1"].resumeApplied).toBe(true);
  });
  it("resumes a waiting mission once per cycle and stops at the persisted budget", () => {
    let m = createMission({ id: "m", companyId: "c", repository: "fixture/repo", prNumber: 1, mode: "fixture", maxResumes: 1 });
    m = applyCommand(m, command("context", context()));
    m = applyCommand(m, command("review", { headSha: B, contextHash: m.context!.hash, phase: "initial", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [] }));
    m = applyCommand(m, command("review", { headSha: B, contextHash: m.context!.hash, phase: "final", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [] }));
    m = applyCommand(m, command("evidence", { headSha: B, baseSha: A, remoteHeadSha: B, currentBaseSha: A, observedAt: "2026-09-29T00:00:00Z", sourceRefs: ["fixture"], conflict: null, checks: [], jobs: [], approvals: { satisfied: null, sourceRef: "fixture" }, conversations: { resolved: null, sourceRef: "fixture" }, rules: { satisfied: null, allowsSkipped: false, allowsNeutral: false, sourceRef: "fixture" }, tests: [] }, "coordinator"));
    expect(m.stage).toBe("waiting_external");
    m = applyCommand(m, command("resume", {}, "coordinator"));
    expect(m.stage).toBe("readiness");
    expect(m.budgets.resumesReserved).toBe(1);
    expect(m.pendingIssue?.key).toContain("readiness-0-1");
    expect(() => applyCommand(m, command("resume", {}, "coordinator"))).toThrow(/Expected stage/);
    m = applyCommand(m, command("evidence", { headSha: B, baseSha: A, remoteHeadSha: B, currentBaseSha: A, observedAt: "2026-09-29T00:00:00Z", sourceRefs: ["fixture"], conflict: null, checks: [], jobs: [], approvals: { satisfied: null, sourceRef: "fixture" }, conversations: { resolved: null, sourceRef: "fixture" }, rules: { satisfied: null, allowsSkipped: false, allowsNeutral: false, sourceRef: "fixture" }, tests: [] }, "coordinator"));
    m = applyCommand(m, command("resume", {}, "coordinator"));
    expect(m.stage).toBe("budget_exhausted");
    expect(m.budgets.resumesReserved).toBe(1);
  });
  it("records a finding decision and keeps optional suggestions nonblocking", () => {
    let m = createMission({ id: "m", companyId: "c", repository: "fixture/repo", prNumber: 1, mode: "fixture" });
    m = applyCommand(m, command("context", context()));
    m = applyCommand(m, command("review", { headSha: B, contextHash: m.context!.hash, phase: "initial", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [
      { cause: "incorrect sum", invariant: "addition", severity: "medium", path: "math.js", line: 1, evidence: "diff", impact: "wrong value" },
      { cause: "naming preference", invariant: "style", severity: "suggestion", path: "math.js", line: 1, evidence: "diff", impact: "readability" }
    ] }));
    expect(m.stage).toBe("correction_intent");
    expect(() => applyCommand(m, command("decision", { findingId: m.findings[0].id, status: "duplicate", reason: "same defect" }))).toThrow(/duplicateOf/);
    m = applyCommand(m, command("decision", { findingId: m.findings[0].id, status: "rejected", reason: "Requirement permits this behavior" }));
    expect(m.stage).toBe("final_review");
    expect(m.findings[0].reason).toBe("Requirement permits this behavior");
    expect(m.findings[1].status).toBe("open");
  });
});
