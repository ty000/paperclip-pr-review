import { createHash } from "node:crypto";

export type Stage = "context" | "initial_review" | "correction_intent" | "correction" | "final_review" | "readiness" | "waiting_external" | "needs_intervention" | "budget_exhausted" | "verified_mergeable";
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
  issueIds: Record<string, string>; rootIssueId: string | null;
  effects: Record<string, { kind: string; state: "reserved" | "confirmed"; at: string; receipt?: string }>;
  verdict: { state: Stage; reasons: string[]; headSha: string; baseSha: string; at: string; sourceRefs: string[] } | null;
  createdAt: string; updatedAt: string; version: number;
}
export type MissionCommand = { kind: string; payload: Record<string, unknown>; actorId: string; at: string };
const SHA = /^[0-9a-f]{40}$/i;
const text = (v: unknown, label: string): string => { if (typeof v !== "string" || !v.trim()) throw new Error(`${label} is required`); return v.trim(); };
const array = (v: unknown, label: string): unknown[] => { if (!Array.isArray(v)) throw new Error(`${label} must be an array`); return v; };
const strings = (v: unknown, label: string): string[] => array(v, label).map((s, i) => text(s, `${label}[${i}]`));
const sha = (v: unknown, label: string): string => { const s = text(v, label).toLowerCase(); if (!SHA.test(s)) throw new Error(`${label} must be a 40-character SHA`); return s; };
const record = (v: unknown, label: string): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${label} must be an object`); return v as Record<string, unknown>; };
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
  return { schemaVersion: 1, id: input.id, companyId: input.companyId, repository: input.repository, prNumber: input.prNumber, mode: input.mode === "fixture" ? "fixture" : "github", rights, stage: "context", headSha: "", baseSha: "", context: null, findings: [], review: null, lastFixerActorId: null, correctionIntent: null, budgets: { maxCorrections, correctionsReserved: 0, correctionsConfirmed: 0, maxResumes, resumesReserved: 0, resumesConfirmed: 0 }, pendingIssue: { key: "context-0", role: "coordinator", description: `Prepare context for ${input.repository}#${input.prNumber}. Submit the versioned context to the plugin API.` }, issueIds: {}, rootIssueId: null, effects: {}, verdict: null, createdAt: now, updatedAt: now, version: 0 };
}

const issue = (m: Mission, role: "coordinator" | "reviewer" | "fixer", stage: string, description: string) => ({ key: `${stage}-${m.budgets.correctionsConfirmed}-${m.budgets.resumesReserved}-${m.headSha.slice(0, 12)}`, role, description: `${description}\nMission: ${m.id}\nHead: ${m.headSha}\nContext hash: ${m.context?.hash ?? "pending"}. Read current state from the plugin API before acting.` });
function requireStage(m: Mission, ...stages: Stage[]) { if (!stages.includes(m.stage)) throw new Error(`Expected stage ${stages.join(" or ")}, got ${m.stage}`); }

export function evaluateReadiness(m: Mission, e: ReadinessEvidence): string[] {
  const reasons: string[] = [];
  if (!m.context || !m.review || m.review.phase !== "final" || !m.review.coverage.complete || m.review.coverage.limits.length) reasons.push("final independent review coverage incomplete");
  if (m.review && m.review.actorId === m.lastFixerActorId) reasons.push("fixer was final validator");
  if (m.findings.some(f => ((f.status === "open" || f.status === "deferred") && f.severity !== "suggestion") || (f.status === "rejected" && ["critical", "high"].includes(f.severity)) || (f.status === "duplicate" && (!f.duplicateOf || !m.findings.some(other => other.id === f.duplicateOf))))) reasons.push("actionable or serious finding unresolved");
  if (m.context && (m.context.objective === null || m.context.acceptanceCriteria.length === 0 || m.context.unknowns.length || m.context.coverageLimits.length)) reasons.push("context incomplete");
  if (e.headSha !== m.headSha || e.baseSha !== m.baseSha || e.remoteHeadSha !== m.headSha || e.currentBaseSha !== m.baseSha) reasons.push("head or base evidence stale");
  if (!e.sourceRefs.length || !e.observedAt || Number.isNaN(Date.parse(e.observedAt))) reasons.push("readiness provenance missing");
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
      if (existing) { existing.observations.push({ headSha: next.headSha, at, actorId: command.actorId }); if (existing.status === "fixed") { existing.status = "open"; existing.reason = "Observed again on current head"; } }
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
      if (!canonical || canonical.id === finding.id) throw new Error("Duplicate requires another canonical finding");
      finding.duplicateOf = canonical.id;
    }
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
    const e = p as unknown as ReadinessEvidence;
    if (!Array.isArray(e.checks) || !Array.isArray(e.jobs) || !Array.isArray(e.tests) || !Array.isArray(e.sourceRefs) || !e.rules || !e.approvals || !e.conversations) throw new Error("Incomplete readiness evidence schema");
    const reasons = evaluateReadiness(next, e);
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
      if (kind === "resume") { if (next.budgets.resumesReserved >= next.budgets.maxResumes) { next.stage = "budget_exhausted"; return next; } next.budgets.resumesReserved++; }
      next.effects[key] = { kind, state: "reserved", at };
    } else if (action === "confirm") {
      const effect = next.effects[key]; if (!effect || effect.kind !== kind) throw new Error("Effect must be reserved first");
      if (effect.state !== "confirmed" && kind === "resume") next.budgets.resumesConfirmed++;
      effect.state = "confirmed"; effect.receipt = text(p.receipt, "receipt");
    } else throw new Error("action must be reserve or confirm");
  } else if (command.kind === "resume") {
    requireStage(next, "waiting_external", "needs_intervention");
    if (next.budgets.resumesReserved >= next.budgets.maxResumes) { next.stage = "budget_exhausted"; next.pendingIssue = null; return next; }
    next.budgets.resumesReserved++;
    next.stage = "readiness";
    next.verdict = null;
    next.pendingIssue = issue(next, "coordinator", "readiness", "Reconcile external state, then gather fresh readiness evidence. Check reserved effects before retrying writes.");
  } else if (command.kind === "invalidate") {
    const reason = text(p.reason, "reason"), sourceRef = text(p.sourceRef, "sourceRef");
    const head = sha(p.headSha, "headSha"), base = sha(p.baseSha, "baseSha");
    next.verdict = { state: "waiting_external", reasons: [`Invalidated: ${reason}`], headSha: head, baseSha: base, at, sourceRefs: [sourceRef] };
    if (head !== next.headSha || base !== next.baseSha) {
      next.headSha = head; next.baseSha = base; next.context = null; next.review = null; next.stage = "context";
      next.pendingIssue = issue(next, "coordinator", "context", "Refresh context after an observed head or base change.");
    } else { next.stage = "readiness"; next.pendingIssue = issue(next, "coordinator", "readiness", "Recheck fresh platform evidence after a relevant event."); }
  } else throw new Error("Unknown mission command");
  return next;
}
