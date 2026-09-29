import { describe, expect, it } from "vitest";
import { applyCommand, createMission, evaluateReadiness, validateContext } from "../src/workflow.js";

const A = "a".repeat(40), B = "b".repeat(40);
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
    const good = { headSha: B, baseSha: A, remoteHeadSha: B, currentBaseSha: A, observedAt: "2026-09-29T00:00:00Z", sourceRefs: ["fixture:status"], conflict: false, checks: [{ name: "test", conclusion: "success" as const, required: true, applicable: true, sourceRef: "fixture:check" }], jobs: [], approvals: { satisfied: true, sourceRef: "fixture:approval" }, conversations: { resolved: true, sourceRef: "fixture:threads" }, rules: { satisfied: true, allowsSkipped: false, allowsNeutral: false, sourceRef: "fixture:rules" }, tests: [{ name: "test", passed: true, sourceRef: "fixture:test" }] };
    expect(evaluateReadiness(m, good)).toEqual([]);
    expect(evaluateReadiness(m, { ...good, checks: [{ ...good.checks[0], conclusion: "failure" }] })).not.toEqual([]);
    expect(evaluateReadiness(m, { ...good, checks: [{ ...good.checks[0], conclusion: "pending" }] })).not.toEqual([]);
    expect(evaluateReadiness(m, { ...good, conflict: true })).not.toEqual([]);
    expect(evaluateReadiness(m, { ...good, approvals: { ...good.approvals, satisfied: false } })).not.toEqual([]);
    expect(evaluateReadiness(m, { ...good, jobs: [{ name: "red", conclusion: "failure", explained: false, sourceRef: "fixture:job" }] })).not.toEqual([]);
    expect(evaluateReadiness({ ...m, review: { ...m.review!, coverage: { ...m.review!.coverage, complete: false } } }, good)).toContain("final independent review coverage incomplete");
    expect(evaluateReadiness({ ...m, findings: [{ id: "f", cause: "wrong operator", invariant: "sum", severity: "high", path: "math.js", line: 1, evidence: "fixture", impact: "wrong result", status: "open", reason: "", observations: [], correctionRefs: [], verificationRefs: [] }] }, good)).toContain("actionable or serious finding unresolved");
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
