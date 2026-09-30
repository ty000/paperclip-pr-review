import { createHash } from "node:crypto";

export type Stage = "context" | "initial_review" | "correction_intent" | "correction" | "final_review" | "readiness" | "waiting_external" | "needs_intervention" | "budget_exhausted" | "verified_mergeable" | "merged_externally";
export type FindingStatus = "open" | "fixed" | "rejected" | "duplicate" | "deferred";
export interface Finding {
  id: string; cause: string; invariant: string; severity: "critical" | "high" | "medium" | "low" | "suggestion";
  path: string; line: number; evidence: string; impact: string; status: FindingStatus;
  reason: string; observations: Array<{ headSha: string; at: string; actorId: string }>;
  correctionRefs: string[]; verificationRefs: string[]; duplicateOf?: string;
}
export interface ReviewContext {
  schemaVersion: 1; repository: string; prNumber: number; baseSha: string; headSha: string;
  objective: string | null; scope: string[]; acceptanceCriteria: Array<{ criterion: string; sourceRef: string }>;
  files: string[]; behaviors: string[]; exclusions: string[]; risks: Array<{ risk: string; evidence: string }>;
  decisions: Array<{ decision: string; reason: string; sourceRef: string }>;
  previousFindings: Array<{ id: string; disposition: string }>;
  changesSincePrevious: string[]; tests: Array<{ name: string; status: string; sourceRef: string }>;
  ci: Array<{ name: string; status: string; sourceRef: string }>;
  unknowns: string[]; coverageLimits: string[]; sourceRefs: string[];
  hash: string;
}
export interface Coverage { complete: boolean; criteria: string[]; files: string[]; limits: string[]; }
export interface ReadinessEvidence {
  headSha: string; baseSha: string; observedAt: string; sourceRefs: string[];
  remoteHeadSha: string; currentBaseSha: string; conflict: boolean | null;
  checks: Array<{ name: string; conclusion: "success" | "failure" | "pending" | "skipped" | "neutral" | "unknown"; required: boolean; applicable: boolean; sourceRef: string }>;
  jobs: Array<{ name: string; conclusion: "success" | "failure" | "pending" | "skipped" | "neutral" | "unknown"; explained: boolean; sourceRef: string }>;
  approvals: { satisfied: boolean | null; sourceRef: string };
  conversations: { resolved: boolean | null; sourceRef: string };
  rules: { satisfied: boolean | null; allowsSkipped: boolean; allowsNeutral: boolean; sourceRef: string };
  tests: Array<{ name: string; passed: boolean; sourceRef: string }>;
}
export interface Mission {
  schemaVersion: 1; id: string; companyId: string; repository: string; prNumber: number; mode: "github" | "fixture";
  rights: { modify: boolean; push: boolean; comment: boolean; resolveThreads: boolean };
  stage: Stage; headSha: string; baseSha: string; context: ReviewContext | null;
  findings: Finding[]; review: { phase: "initial" | "final"; actorId: string; headSha: string; contextHash: string; coverage: Coverage; at: string } | null;
  lastFixerActorId: string | null; correctionIntent: { findingIds: string[]; defect: string; change: string; expectedProof: string; actorId: string; at: string } | null;
  budgets: { maxCorrections: number; correctionsReserved: number; correctionsConfirmed: number; maxResumes: number; resumesReserved: number; resumesConfirmed: number };
  pendingIssue: { key: string; role: "coordinator" | "reviewer" | "fixer"; description: string; leaseOwner?: string; leaseUntil?: string } | null;
  issueIds: Record<string, string>; rootIssueId: string | null; phaseSequence: number;
  effects: Record<string, { kind: string; state: "reserved" | "confirmed"; at: string; receipt?: string; resumeApplied?: boolean }>;
  verdict: { state: Stage; reasons: string[]; headSha: string; baseSha: string; at: string; sourceRefs: string[] } | null;
  // Optional so previously persisted schemaVersion 1 missions remain readable.
  closure?: { repository: string; prNumber: number; mergedAt: string; mergeCommitSha: string; observedAt: string; sourceRef: string; actorId: string; recordedAt: string; previousStage: Stage; pendingIssueKey: string | null; dispatchOwner: string | null; dispatchPending: boolean; issuesReconciled: boolean };
  createdAt: string; updatedAt: string; version: number;
}
export type MissionCommand = { kind: string; payload: Record<string, unknown>; actorId: string; at: string };
const SHA = /^[0-9a-f]{40}$/i;
const text = (v: unknown, label: string): string => { if (typeof v !== "string" || !v.trim()) throw new Error(`${label} is required`); return v.trim(); };
const array = (v: unknown, label: string): unknown[] => { if (!Array.isArray(v)) throw new Error(`${label} must be an array`); return v; };
const strings = (v: unknown, label: string): string[] => array(v, label).map((s, i) => text(s, `${label}[${i}]`));
const sha = (v: unknown, label: string): string => { const s = text(v, label).toLowerCase(); if (!SHA.test(s)) throw new Error(`${label} must be a 40-character SHA`); return s; };
const record = (v: unknown, label: string): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${label} must be an object`); return v as Record<string, unknown>; };
const boolean = (v: unknown, label: string): boolean => { if (typeof v !== "boolean") throw new Error(`${label} must be a boolean`); return v; };
const nullableBoolean = (v: unknown, label: string): boolean | null => v === null ? null : boolean(v, label);
const conclusions = ["success", "failure", "pending", "skipped", "neutral", "unknown"] as const;
const severityRank = (severity: Finding["severity"]): number => ["suggestion", "low", "medium", "high", "critical"].indexOf(severity);
function conclusion(v: unknown, label: string): ReadinessEvidence["checks"][number]["conclusion"] {
  if (!conclusions.some(candidate => candidate === v)) throw new Error(`${label} has an invalid conclusion`);
  return v as ReadinessEvidence["checks"][number]["conclusion"];
}
export function validateReadinessEvidence(value: unknown): ReadinessEvidence {
  const e = record(value, "readiness evidence");
  const platform = (value: unknown, label: string, field: "satisfied" | "resolved") => {
    const r = record(value, label);
    return { [field]: nullableBoolean(r[field], `${label}.${field}`), sourceRef: text(r.sourceRef, `${label}.sourceRef`) };
  };
  const rules = record(e.rules, "rules");
  const observedAt = text(e.observedAt, "observedAt");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(observedAt) || Number.isNaN(Date.parse(observedAt)) || new Date(observedAt).toISOString().slice(0, 19) !== observedAt.slice(0, 19)) throw new Error("observedAt must be a valid UTC timestamp");
  return {
    headSha: sha(e.headSha, "headSha"), baseSha: sha(e.baseSha, "baseSha"),
    remoteHeadSha: sha(e.remoteHeadSha, "remoteHeadSha"), currentBaseSha: sha(e.currentBaseSha, "currentBaseSha"),
    observedAt, sourceRefs: strings(e.sourceRefs, "sourceRefs"), conflict: nullableBoolean(e.conflict, "conflict"),
    checks: array(e.checks, "checks").map((value, i) => {
      const c = record(value, `checks[${i}]`);
      return { name: text(c.name, `checks[${i}].name`), conclusion: conclusion(c.conclusion, `checks[${i}]`), required: boolean(c.required, `checks[${i}].required`), applicable: boolean(c.applicable, `checks[${i}].applicable`), sourceRef: text(c.sourceRef, `checks[${i}].sourceRef`) };
    }),
    jobs: array(e.jobs, "jobs").map((value, i) => {
      const j = record(value, `jobs[${i}]`);
      return { name: text(j.name, `jobs[${i}].name`), conclusion: conclusion(j.conclusion, `jobs[${i}]`), explained: boolean(j.explained, `jobs[${i}].explained`), sourceRef: text(j.sourceRef, `jobs[${i}].sourceRef`) };
    }),
    approvals: platform(e.approvals, "approvals", "satisfied") as ReadinessEvidence["approvals"],
    conversations: platform(e.conversations, "conversations", "resolved") as ReadinessEvidence["conversations"],
    rules: { satisfied: nullableBoolean(rules.satisfied, "rules.satisfied"), allowsSkipped: boolean(rules.allowsSkipped, "rules.allowsSkipped"), allowsNeutral: boolean(rules.allowsNeutral, "rules.allowsNeutral"), sourceRef: text(rules.sourceRef, "rules.sourceRef") },
    tests: array(e.tests, "tests").map((value, i) => {
      const t = record(value, `tests[${i}]`);
      return { name: text(t.name, `tests[${i}].name`), passed: boolean(t.passed, `tests[${i}].passed`), sourceRef: text(t.sourceRef, `tests[${i}].sourceRef`) };
    })
  };
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable((value as Record<string, unknown>)[k])]));
  return value;
}
export function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

export function validateContext(input: Record<string, unknown>): ReviewContext {
  if (input.schemaVersion !== 1) throw new Error("Context schemaVersion must be 1");
  const criteria = array(input.acceptanceCriteria, "acceptanceCriteria").map(x => { const r = record(x, "criterion"); return { criterion: text(r.criterion, "criterion"), sourceRef: text(r.sourceRef, "criterion.sourceRef") }; });
  const risks = array(input.risks, "risks").map(x => { const r = record(x, "risk"); return { risk: text(r.risk, "risk"), evidence: text(r.evidence, "risk.evidence") }; });
  if (risks.length < 1 || risks.length > 5) throw new Error("Context requires 1-5 prioritized risks");
  const decisions = array(input.decisions, "decisions").map(x => { const r = record(x, "decision"); return { decision: text(r.decision, "decision"), reason: text(r.reason, "decision.reason"), sourceRef: text(r.sourceRef, "decision.sourceRef") }; });
  const previousFindings = array(input.previousFindings, "previousFindings").map(x => { const r = record(x, "previousFinding"); return { id: text(r.id, "finding.id"), disposition: text(r.disposition, "finding.disposition") }; });
  const observations = (v: unknown, label: string) => array(v, label).map(x => { const r = record(x, label); return { name: text(r.name, `${label}.name`), status: text(r.status, `${label}.status`), sourceRef: text(r.sourceRef, `${label}.sourceRef`) }; });
  const result = {
    schemaVersion: 1 as const, repository: text(input.repository, "repository"), prNumber: Number(input.prNumber),
    baseSha: sha(input.baseSha, "baseSha"), headSha: sha(input.headSha, "headSha"),
    objective: input.objective === null ? null : text(input.objective, "objective"),
    scope: strings(input.scope, "scope"), acceptanceCriteria: criteria, files: strings(input.files, "files"), behaviors: strings(input.behaviors, "behaviors"),
    exclusions: strings(input.exclusions, "exclusions"), risks, decisions, previousFindings,
    changesSincePrevious: strings(input.changesSincePrevious, "changesSincePrevious"), tests: observations(input.tests, "tests"), ci: observations(input.ci, "ci"),
    unknowns: strings(input.unknowns, "unknowns"), coverageLimits: strings(input.coverageLimits, "coverageLimits"), sourceRefs: strings(input.sourceRefs, "sourceRefs")
  };
  if (!Number.isInteger(result.prNumber) || result.prNumber < 1 || result.sourceRefs.length === 0) throw new Error("PR number and source refs required");
  return { ...result, hash: digest(result) };
}

export function createMission(input: { id: string; companyId: string; repository: string; prNumber: number; maxCorrections?: unknown; maxResumes?: unknown; mode?: unknown; rights?: unknown }): Mission {
  const budget = (v: unknown, fallback: number) => v === undefined ? fallback : Number(v);
  const maxCorrections = budget(input.maxCorrections, 3), maxResumes = budget(input.maxResumes, 8);
  if (![maxCorrections, maxResumes].every(n => Number.isInteger(n) && n >= 0 && n <= 100)) throw new Error("Budgets must be integers in 0..100");
  if (input.mode !== undefined && input.mode !== "fixture" && input.mode !== "github") throw new Error("mode must be github or fixture");
  const rawRights = input.rights === undefined ? {} : record(input.rights, "rights");
  if (Object.values(rawRights).some(v => typeof v !== "boolean")) throw new Error("rights values must be booleans");
  const rights = { modify: rawRights.modify === true || input.mode === "fixture", push: rawRights.push === true, comment: rawRights.comment === true, resolveThreads: rawRights.resolveThreads === true };
  const now = new Date().toISOString();
  return { schemaVersion: 1, id: input.id, companyId: input.companyId, repository: input.repository, prNumber: input.prNumber, mode: input.mode === "fixture" ? "fixture" : "github", rights, stage: "context", headSha: "", baseSha: "", context: null, findings: [], review: null, lastFixerActorId: null, correctionIntent: null, budgets: { maxCorrections, correctionsReserved: 0, correctionsConfirmed: 0, maxResumes, resumesReserved: 0, resumesConfirmed: 0 }, pendingIssue: { key: "context-0", role: "coordinator", description: `Prepare context for ${input.repository}#${input.prNumber}. Submit the versioned context to the plugin API.` }, issueIds: {}, rootIssueId: null, phaseSequence: 0, effects: {}, verdict: null, createdAt: now, updatedAt: now, version: 0 };
}

const issue = (m: Mission, role: "coordinator" | "reviewer" | "fixer", stage: string, description: string) => {
  m.phaseSequence = (m.phaseSequence ?? 0) + 1;
  return { key: `${stage}-${m.budgets.correctionsConfirmed}-${m.budgets.resumesReserved}-${m.headSha.slice(0, 12)}-${(m.context?.hash ?? m.baseSha).slice(0, 12)}-${m.phaseSequence}`, role, description: `${description}\nMission: ${m.id}\nHead: ${m.headSha}\nContext hash: ${m.context?.hash ?? "pending"}. Read current state from the plugin API before acting.` };
};
function requireStage(m: Mission, ...stages: Stage[]) { if (!stages.includes(m.stage)) throw new Error(`Expected stage ${stages.join(" or ")}, got ${m.stage}`); }

export function evaluateReadiness(m: Mission, evidence: ReadinessEvidence, referenceAt = new Date().toISOString()): string[] {
  let e: ReadinessEvidence;
  try { e = validateReadinessEvidence(evidence); }
  catch { return ["readiness evidence malformed"]; }
  const reasons: string[] = [];
  if (!m.context || !m.review || m.review.phase !== "final" || !m.review.coverage.complete || m.review.coverage.limits.length) reasons.push("final independent review coverage incomplete");
  if (m.review && m.review.actorId === m.lastFixerActorId) reasons.push("fixer was final validator");
  if (m.findings.some(f => ((f.status === "open" || f.status === "deferred") && f.severity !== "suggestion") || (f.status === "rejected" && ["critical", "high"].includes(f.severity)) || (f.status === "duplicate" && (!f.duplicateOf || !m.findings.some(other => other.id === f.duplicateOf && other.status !== "duplicate" && severityRank(other.severity) >= severityRank(f.severity)))))) reasons.push("actionable or serious finding unresolved");
  if (m.context && (m.context.objective === null || m.context.acceptanceCriteria.length === 0 || m.context.unknowns.length || m.context.coverageLimits.length)) reasons.push("context incomplete");
  if (e.headSha !== m.headSha || e.baseSha !== m.baseSha || e.remoteHeadSha !== m.headSha || e.currentBaseSha !== m.baseSha) reasons.push("head or base evidence stale");
  if (!e.sourceRefs.length) reasons.push("readiness provenance missing");
  const ageMs = Date.parse(referenceAt) - Date.parse(e.observedAt);
  if (!Number.isFinite(ageMs) || ageMs > 10 * 60_000 || ageMs < -60_000) reasons.push("readiness evidence stale or future-dated");
  if (e.conflict !== false) reasons.push("merge conflict or conflict state unknown");
  if (e.rules.satisfied !== true || e.approvals.satisfied !== true || e.conversations.resolved !== true) reasons.push("rules, approvals or conversations unsatisfied");
  if (![e.rules.sourceRef, e.approvals.sourceRef, e.conversations.sourceRef].every(Boolean)) reasons.push("platform evidence source missing");
  if (!e.checks.length || e.checks.some(c => !c.sourceRef || c.conclusion === "failure" || c.conclusion === "pending" || c.conclusion === "unknown" || (c.required && c.conclusion !== "success" && !(c.conclusion === "skipped" && e.rules.allowsSkipped) && !(c.conclusion === "neutral" && e.rules.allowsNeutral)) || (c.applicable && c.conclusion === "skipped" && !e.rules.allowsSkipped))) reasons.push("required or applicable check not satisfied");
  if (e.jobs.some(j => !j.sourceRef || j.conclusion === "pending" || j.conclusion === "unknown" || (j.conclusion === "failure" && !j.explained))) reasons.push("job failure or unknown state unexplained");
  if (!e.tests.length || e.tests.some(t => !t.passed || !t.sourceRef)) reasons.push("tests missing or failed");
  return [...new Set(reasons)];
}

export function applyCommand(m: Mission, command: MissionCommand): Mission {
  const p = command.payload, at = command.at;
  if (command.kind === "close") return closeMergedMission(m, command);
  if (m.stage === "merged_externally") throw new Error("Mission is closed after external merge");
  const next = structuredClone(m);
  next.updatedAt = at;
  if (command.kind === "context") {
    requireStage(next, "context", "waiting_external", "needs_intervention");
    const c = validateContext(p);
    if (c.repository !== next.repository || c.prNumber !== next.prNumber) throw new Error("Context PR identity differs from mission");
    next.context = c; next.headSha = c.headSha; next.baseSha = c.baseSha; next.review = null; next.verdict = null;
    next.stage = "initial_review";
    next.pendingIssue = issue(next, "reviewer", "review", "Review the pinned PR and submit concrete findings with coverage.");
  } else if (command.kind === "review") {
    requireStage(next, "initial_review", "final_review");
    if (sha(p.headSha, "headSha") !== next.headSha || text(p.contextHash, "contextHash") !== next.context?.hash) throw new Error("Stale review head or context hash");
    const phase = next.stage === "final_review" ? "final" : "initial";
    if (p.phase !== phase) throw new Error(`Expected ${phase} review`);
    const coverageRaw = record(p.coverage, "coverage");
    const coverage: Coverage = { complete: coverageRaw.complete === true, criteria: strings(coverageRaw.criteria, "coverage.criteria"), files: strings(coverageRaw.files, "coverage.files"), limits: strings(coverageRaw.limits, "coverage.limits") };
    if (coverage.complete && next.context && (next.context.acceptanceCriteria.some(c => !coverage.criteria.includes(c.criterion)) || next.context.files.some(f => !coverage.files.includes(f)))) throw new Error("Review does not cover every acceptance criterion and file");
    const observations = array(p.findings, "findings").map(raw => {
      const f = record(raw, "finding"); const severity = text(f.severity, "severity") as Finding["severity"];
      if (!["critical", "high", "medium", "low", "suggestion"].includes(severity)) throw new Error("Invalid finding severity");
      const path = text(f.path, "path"), cause = text(f.cause, "cause"), invariant = text(f.invariant, "invariant");
      if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("Invalid finding path");
      const line = Number(f.line); if (!Number.isInteger(line) || line < 1) throw new Error("Finding line required");
      return { id: digest({ cause: cause.toLowerCase(), invariant: invariant.toLowerCase(), path }).slice(0, 16), cause, invariant, severity, path, line, evidence: text(f.evidence, "evidence"), impact: text(f.impact, "impact") };
    });
    for (const f of observations) {
      const existing = next.findings.find(x => x.id === f.id);
      if (existing) {
        Object.assign(existing, f);
        existing.observations.push({ headSha: next.headSha, at, actorId: command.actorId });
        existing.status = "open"; existing.reason = "Observed again on current head";
        delete existing.duplicateOf;
      }
      else next.findings.push({ ...f, status: "open", reason: "", observations: [{ headSha: next.headSha, at, actorId: command.actorId }], correctionRefs: [], verificationRefs: [] });
    }
    next.review = { phase, actorId: command.actorId, headSha: next.headSha, contextHash: next.context!.hash, coverage, at };
    if (phase === "final" && coverage.complete && !coverage.limits.length) for (const f of next.findings) if (f.status === "fixed") f.verificationRefs.push(`review:${next.headSha}:${next.context!.hash}`);
    const actionable = next.findings.some(f => f.status === "open" && f.severity !== "suggestion");
    if (actionable) {
      next.stage = next.budgets.correctionsReserved >= next.budgets.maxCorrections ? "budget_exhausted" : "correction_intent";
      next.pendingIssue = next.stage === "correction_intent" ? issue(next, "fixer", "fix", "Read findings, submit correction intent, then correct and test.") : null;
    } else if (!coverage.complete || coverage.limits.length) { next.stage = "needs_intervention"; next.pendingIssue = null; }
    else if (phase === "initial") { next.stage = "final_review"; next.pendingIssue = issue(next, "reviewer", "final", "Perform final independent review for readiness."); }
    else { next.stage = "readiness"; next.pendingIssue = issue(next, "coordinator", "readiness", "Collect fresh platform readiness evidence for current base/head."); }
  } else if (command.kind === "decision") {
    requireStage(next, "correction_intent", "readiness", "needs_intervention");
    const finding = next.findings.find(f => f.id === text(p.findingId, "findingId"));
    if (!finding) throw new Error("Finding not found");
    const status = text(p.status, "status") as FindingStatus;
    if (!["rejected", "duplicate", "deferred"].includes(status)) throw new Error("Invalid disposition");
    if (status === "duplicate") {
      const canonical = next.findings.find(f => f.id === text(p.duplicateOf, "duplicateOf"));
      if (!canonical || canonical.id === finding.id || canonical.status === "duplicate" || next.findings.some(f => f.duplicateOf === finding.id)) throw new Error("Duplicate requires an independent canonical finding");
      if (severityRank(canonical.severity) < severityRank(finding.severity)) throw new Error("Canonical finding cannot have lower severity");
      finding.duplicateOf = canonical.id;
    } else delete finding.duplicateOf;
    finding.status = status; finding.reason = text(p.reason, "reason");
    if (next.stage === "correction_intent" && !next.findings.some(f => f.status === "open" && f.severity !== "suggestion")) {
      next.stage = "final_review";
      next.pendingIssue = issue(next, "reviewer", "final", "Independently check finding dispositions and final coverage.");
    }
  } else if (command.kind === "intent") {
    requireStage(next, "correction_intent");
    if (!next.rights.modify) throw new Error("Modification permission is disabled for this mission");
    const findingIds = strings(p.findingIds, "findingIds");
    if (!findingIds.length || findingIds.some(id => !next.findings.some(f => f.id === id && f.status === "open"))) throw new Error("Intent must name open findings");
    if (next.budgets.correctionsReserved >= next.budgets.maxCorrections) { next.stage = "budget_exhausted"; return next; }
    next.budgets.correctionsReserved++;
    next.correctionIntent = { findingIds, defect: text(p.defect, "defect"), change: text(p.change, "change"), expectedProof: text(p.expectedProof, "expectedProof"), actorId: command.actorId, at };
    next.stage = "correction";
  } else if (command.kind === "correction") {
    requireStage(next, "correction");
    const head = sha(p.headSha, "headSha");
    if (head === next.headSha) throw new Error("Correction must produce a new head");
    const tests = array(p.tests, "tests").map(x => record(x, "test"));
    if (!tests.length || tests.some(x => x.passed !== true || !x.sourceRef)) throw new Error("Passing test receipts required");
    const publication = record(p.publication, "publication");
    if (next.mode === "github" && (!next.rights.push || publication.remoteHeadSha !== head || !publication.sourceRef || !Object.values(next.effects).some(e => e.kind === "push" && e.state === "confirmed" && e.receipt?.includes(head)))) throw new Error("Confirmed push receipt and visible remote head are required");
    for (const id of next.correctionIntent!.findingIds) {
      const f = next.findings.find(x => x.id === id)!;
      f.status = "fixed"; f.reason = text(p.summary, "summary"); f.correctionRefs.push(text(publication.sourceRef ?? p.summary, "publication source"));
    }
    next.budgets.correctionsConfirmed++;
    next.lastFixerActorId = command.actorId;
    next.headSha = head; next.context = null; next.review = null; next.verdict = null; next.correctionIntent = null;
    next.stage = "context";
    next.pendingIssue = issue(next, "coordinator", "context", "Refresh context for the new head, preserving previous findings and decisions.");
  } else if (command.kind === "evidence") {
    requireStage(next, "readiness", "waiting_external", "needs_intervention");
    const e = validateReadinessEvidence(p);
    const reasons = evaluateReadiness(next, e, at);
    next.stage = reasons.length ? (reasons.some(x => /pending|unknown|missing|stale/i.test(x)) ? "waiting_external" : "needs_intervention") : "verified_mergeable";
    next.verdict = { state: next.stage, reasons, headSha: next.headSha, baseSha: next.baseSha, at, sourceRefs: e.sourceRefs };
    next.pendingIssue = null;
  } else if (command.kind === "effect") {
    const key = text(p.key, "key"), action = text(p.action, "action"), kind = text(p.kind, "kind");
    if (next.stage === "verified_mergeable" || next.stage === "budget_exhausted") throw new Error("Invalidate the verdict or resolve the budget before another effect");
    if (kind === "comment" && !next.rights.comment) throw new Error("Comment permission is disabled");
    if (kind === "resolve_thread" && !next.rights.resolveThreads) throw new Error("Thread resolution permission is disabled");
    if (kind === "resolve_thread" && next.mode === "github" && (!Object.values(next.effects).some(e => e.kind === "push" && e.state === "confirmed") || !p.justificationSourceRef)) throw new Error("Thread resolution requires confirmed publication and justification evidence");
    if (kind === "push" && !next.rights.push) throw new Error("Push permission is disabled");
    if (action === "reserve") {
      if (next.effects[key]) return next;
      if (kind === "resume") {
        requireStage(next, "waiting_external", "needs_intervention");
        if (Object.values(next.effects).some(e => e.kind === "resume" && e.resumeApplied === undefined)) throw new Error("Legacy resume effect requires operator reconciliation");
        if (Object.values(next.effects).some(e => e.kind === "resume" && e.resumeApplied === false)) throw new Error("A resume effect is already reserved for this cycle");
        if (next.budgets.resumesReserved >= next.budgets.maxResumes) { next.stage = "budget_exhausted"; return next; }
        next.budgets.resumesReserved++;
      }
      next.effects[key] = { kind, state: "reserved", at, ...(kind === "resume" ? { resumeApplied: false } : {}) };
    } else if (action === "confirm") {
      const effect = next.effects[key]; if (!effect || effect.kind !== kind) throw new Error("Effect must be reserved first");
      if (effect.state !== "confirmed" && kind === "resume") next.budgets.resumesConfirmed++;
      effect.state = "confirmed"; effect.receipt = text(p.receipt, "receipt");
    } else throw new Error("action must be reserve or confirm");
  } else if (command.kind === "resume") {
    requireStage(next, "waiting_external", "needs_intervention");
    if (Object.values(next.effects).some(e => e.kind === "resume" && e.resumeApplied === undefined)) throw new Error("Legacy resume effect requires operator reconciliation");
    const reservedEffect = Object.values(next.effects).find(e => e.kind === "resume" && e.resumeApplied === false);
    if (!reservedEffect) {
      if (next.budgets.resumesReserved >= next.budgets.maxResumes) { next.stage = "budget_exhausted"; next.pendingIssue = null; return next; }
      next.budgets.resumesReserved++;
    } else {
      if (reservedEffect.state !== "confirmed") throw new Error("Reserved resume effect requires reconciliation receipt");
      reservedEffect.resumeApplied = true;
    }
    next.stage = "readiness";
    next.verdict = null;
    next.pendingIssue = issue(next, "coordinator", "readiness", "Reconcile external state, then gather fresh readiness evidence. Check reserved effects before retrying writes.");
  } else if (command.kind === "invalidate") {
    const reason = text(p.reason, "reason"), sourceRef = text(p.sourceRef, "sourceRef");
    const head = sha(p.headSha, "headSha"), base = sha(p.baseSha, "baseSha");
    if ((next.stage === "context" || next.stage === "readiness") && next.verdict?.state === "waiting_external" && next.verdict.reasons.length === 1 && next.verdict.reasons[0] === `Invalidated: ${reason}` && next.verdict.headSha === head && next.verdict.baseSha === base && next.verdict.sourceRefs.length === 1 && next.verdict.sourceRefs[0] === sourceRef) return next;
    next.verdict = { state: "waiting_external", reasons: [`Invalidated: ${reason}`], headSha: head, baseSha: base, at, sourceRefs: [sourceRef] };
    if (head !== next.headSha || base !== next.baseSha) {
      next.headSha = head; next.baseSha = base; next.context = null; next.review = null; next.stage = "context";
      next.pendingIssue = issue(next, "coordinator", "context", "Refresh context after an observed head or base change.");
    } else { next.stage = "readiness"; next.pendingIssue = issue(next, "coordinator", "readiness", "Recheck fresh platform evidence after a relevant event."); }
  } else throw new Error("Unknown mission command");
  return next;
}

function closeMergedMission(m: Mission, command: MissionCommand): Mission {
  const p = command.payload;
  if (p.merged !== true) throw new Error("Explicit merged: true observation required");
  if (p.repository !== m.repository || p.prNumber !== m.prNumber) throw new Error("Merge PR identity differs from mission");
  const utc = (value: unknown, label: string) => {
    const s = text(value, label);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 19) !== s.slice(0, 19)) throw new Error(`${label} must be a valid UTC timestamp`);
    return new Date(s).toISOString();
  };
  const mergedAt = utc(p.mergedAt, "mergedAt"), observedAt = utc(p.observedAt, "observedAt");
  const mergeCommitSha = sha(p.mergeCommitSha, "mergeCommitSha"), sourceRef = text(p.sourceRef, "sourceRef");
  if (Date.parse(mergedAt) > Date.parse(observedAt)) throw new Error("Merge cannot follow its observation");
  if (m.stage === "merged_externally") {
    if (m.closure?.mergeCommitSha !== mergeCommitSha || m.closure.mergedAt !== mergedAt) throw new Error("Conflicting merge closure evidence");
    return m; // A delayed retry preserves the original evidence, actor and version.
  }
  const age = Date.parse(command.at) - Date.parse(observedAt);
  if (!Number.isFinite(age) || age > 600_000 || age < -60_000) throw new Error("Merge observation is stale or future-dated");
  return {
    ...structuredClone(m), stage: "merged_externally", pendingIssue: null, updatedAt: command.at,
    closure: { repository: m.repository, prNumber: m.prNumber, mergedAt, mergeCommitSha, observedAt, sourceRef, actorId: command.actorId, recordedAt: command.at, previousStage: m.stage, pendingIssueKey: m.pendingIssue?.key ?? null, dispatchOwner: m.pendingIssue?.leaseOwner ?? null, dispatchPending: Boolean(m.pendingIssue?.leaseOwner || m.pendingIssue?.leaseUntil), issuesReconciled: false }
  };
}
