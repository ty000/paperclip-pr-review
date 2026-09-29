import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const api = process.env.PAPERCLIP_TEST_API?.replace(/\/$/, "");
const companyId = process.env.PAPERCLIP_TEST_COMPANY;
if (!api || !companyId) throw new Error("PAPERCLIP_TEST_API and PAPERCLIP_TEST_COMPANY are required");
const plugin = "/api/plugins/ty000.plugin-pr-review/api";
const outcomes = [];
async function request(method, route, body, expected = 200) {
  const response = await fetch(`${api}${route}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result)}`);
  return result;
}
const post = (route, body, expected = 200) => request("POST", `${plugin}${route}`, { companyId, ...body }, expected);
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pr-review-host-fixture-"));
git(dir, "init", "-q"); git(dir, "config", "user.name", "PR Review Fixture"); git(dir, "config", "user.email", "fixture@example.invalid");
await fs.writeFile(path.join(dir, "math.js"), "export function add(a, b) { return a + b; }\n");
git(dir, "add", "."); git(dir, "commit", "-qm", "base correct addition");
const baseSha = git(dir, "rev-parse", "HEAD");
await fs.writeFile(path.join(dir, "math.js"), "export function add(a, b) { return a - b; }\n");
git(dir, "add", "."); git(dir, "commit", "-qm", "introduce wrong operator");
const badSha = git(dir, "rev-parse", "HEAD");
const badModule = await import(`data:text/javascript,${encodeURIComponent(await fs.readFile(path.join(dir, "math.js"), "utf8"))}`);
assert.equal(badModule.add(2, 3), -1);
const repository = `fixture/${path.basename(dir)}`;
const startBody = { repository, prNumber: 1, mode: "fixture", maxCorrections: 1, maxResumes: 1 };
const started = await Promise.all([post("/missions", startBody, 201), post("/missions", startBody, 201)]);
assert.equal(started[0].id, started[1].id);
let mission = await request("GET", `${plugin}/missions/${started[0].id}?companyId=${companyId}`);
assert.equal(mission.stage, "context");
assert.equal(Object.keys(mission.issueIds).length, 1);
outcomes.push("concurrent triggers reuse one mission and phase issue");
const missionRoute = `/missions/${mission.id}`;
const resumeKey = `resume:${mission.id}:1`;
mission = await post(`${missionRoute}/effects`, { key: resumeKey, kind: "resume", action: "reserve" });
mission = await post(`${missionRoute}/effects`, { key: resumeKey, kind: "resume", action: "reserve" });
assert.equal(mission.budgets.resumesReserved, 1);
mission = await post(`${missionRoute}/effects`, { key: resumeKey, kind: "resume", action: "confirm", receipt: "fixture:reconciled" });
assert.equal(mission.budgets.resumesConfirmed, 1);
outcomes.push("resume budget is reserved and confirmed once");
const context = (headSha, previousFindings = [], changesSincePrevious = []) => ({ schemaVersion: 1, repository, prNumber: 1, baseSha, headSha, objective: "Addition must return the sum", scope: ["math.js"], acceptanceCriteria: [{ criterion: "Returns a+b", sourceRef: "fixture:requirement" }], files: ["math.js"], behaviors: ["addition"], exclusions: [], risks: [{ risk: "operator error", evidence: `git:${headSha}:math.js` }], decisions: [], previousFindings, changesSincePrevious, tests: [{ name: "fixture", status: "observed", sourceRef: `git:${headSha}` }], ci: [], unknowns: [], coverageLimits: [], sourceRefs: ["fixture:requirement", `git:${headSha}`], simulatedActorId: "coordinator-fixture" });
mission = await post(`${missionRoute}/context`, context(badSha));
assert.equal(mission.stage, "initial_review");
const stale = await post(`${missionRoute}/review`, { headSha: baseSha, contextHash: mission.context.hash, phase: "initial", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [] }, 422);
assert.match(stale.error, /Stale/);
outcomes.push("context hash is shared and stale head review rejected");
const finding = { cause: "subtraction instead of addition", invariant: "sum invariant", severity: "high", path: "math.js", line: 1, evidence: `git:${badSha}:math.js:1`, impact: "Incorrect result" };
mission = await post(`${missionRoute}/review`, { headSha: badSha, contextHash: mission.context.hash, phase: "initial", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [finding, finding], simulatedActorId: "reviewer-fixture" });
assert.equal(mission.findings.length, 1);
assert.equal(mission.findings[0].observations.length, 2);
outcomes.push("duplicate observations retain one finding and both observations");
const findingId = mission.findings[0].id;
mission = await post(`${missionRoute}/intent`, { findingIds: [findingId], defect: "Wrong operator", change: "Replace subtraction with addition", expectedProof: "Calculator test and new commit", simulatedActorId: "fixer-fixture" });
assert.equal(mission.budgets.correctionsReserved, 1);
assert.equal(mission.budgets.correctionsConfirmed, 0);
const effect = { key: `push:${badSha}`, kind: "fixture_publication", action: "reserve", simulatedActorId: "coordinator-fixture" };
mission = await post(`${missionRoute}/effects`, effect);
mission = await post(`${missionRoute}/effects`, effect);
assert.equal(Object.keys(mission.effects).length, 2);
assert.equal(mission.effects[effect.key].state, "reserved");
outcomes.push("external effect reservation survives retry without duplicate");
await fs.writeFile(path.join(dir, "math.js"), "export function add(a, b) { return a + b; }\n");
git(dir, "add", "."); git(dir, "commit", "-qm", "fix operator");
const fixedSha = git(dir, "rev-parse", "HEAD");
assert.match(await fs.readFile(path.join(dir, "math.js"), "utf8"), /a \+ b/);
const fixedModule = await import(`data:text/javascript,${encodeURIComponent(await fs.readFile(path.join(dir, "math.js"), "utf8"))}`);
assert.equal(fixedModule.add(2, 3), 5);
mission = await post(`${missionRoute}/effects`, { key: effect.key, kind: effect.kind, action: "confirm", receipt: `git:${fixedSha}`, simulatedActorId: "coordinator-fixture" });
mission = await post(`${missionRoute}/correction`, { headSha: fixedSha, tests: [{ name: "calculator fixture", passed: true, sourceRef: `git:${fixedSha}` }], publication: { sourceRef: `git:${fixedSha}` }, summary: "Operator corrected and committed", simulatedActorId: "fixer-fixture" });
assert.equal(mission.stage, "context");
assert.equal(mission.budgets.correctionsConfirmed, 1);
outcomes.push("real fixture commit corrects defect and confirms bounded attempt");
mission = await post(`${missionRoute}/context`, context(fixedSha, [{ id: findingId, disposition: "fixed" }], ["Operator changed to +"]));
mission = await post(`${missionRoute}/review`, { headSha: fixedSha, contextHash: mission.context.hash, phase: "initial", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [], simulatedActorId: "reviewer-fixture" });
mission = await post(`${missionRoute}/review`, { headSha: fixedSha, contextHash: mission.context.hash, phase: "final", coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [], simulatedActorId: "reviewer-fixture" });
assert.equal(mission.stage, "readiness");
assert.equal(mission.findings[0].verificationRefs.length, 1);
const evidence = { headSha: fixedSha, baseSha, remoteHeadSha: fixedSha, currentBaseSha: baseSha, observedAt: new Date().toISOString(), sourceRefs: [`git:${fixedSha}`], conflict: false, checks: [{ name: "test", conclusion: "success", required: true, applicable: true, sourceRef: `git:${fixedSha}` }], jobs: [], approvals: { satisfied: true, sourceRef: "fixture:approvals" }, conversations: { resolved: true, sourceRef: "fixture:threads" }, rules: { satisfied: true, allowsSkipped: false, allowsNeutral: false, sourceRef: "fixture:rules" }, tests: [{ name: "calculator fixture", passed: true, sourceRef: `git:${fixedSha}` }], simulatedActorId: "coordinator-fixture" };
for (const [name, override] of [
  ["red CI", { checks: [{ ...evidence.checks[0], conclusion: "failure" }] }],
  ["pending CI", { checks: [{ ...evidence.checks[0], conclusion: "pending" }] }],
  ["conflict", { conflict: true }],
  ["approval", { approvals: { ...evidence.approvals, satisfied: false } }],
  ["unexplained job", { jobs: [{ name: "red", conclusion: "failure", explained: false, sourceRef: "fixture:job" }] }]
]) {
  mission = await post(`${missionRoute}/evidence`, { ...evidence, ...override });
  assert.notEqual(mission.stage, "verified_mergeable", name);
  outcomes.push(`readiness refused: ${name}`);
}
mission = await post(`${missionRoute}/evidence`, evidence);
assert.equal(mission.stage, "verified_mergeable");
assert.equal(mission.verdict.headSha, fixedSha);
outcomes.push("independent final review and fresh evidence reached fixture readiness");
const budgetMission = await post("/missions", { repository, prNumber: 2, mode: "fixture", maxCorrections: 0, maxResumes: 1 }, 201);
const budgetRoute = `/missions/${budgetMission.id}`;
await post(`${budgetRoute}/effects`, { key: "resume-1", kind: "resume", action: "reserve" });
const exhausted = await post(`${budgetRoute}/effects`, { key: "resume-2", kind: "resume", action: "reserve" });
assert.equal(exhausted.stage, "budget_exhausted");
assert.equal(exhausted.budgets.resumesReserved, 1);
outcomes.push("second resume after budget exhaustion stops explicitly");
let waiting = await post("/missions", { repository, prNumber: 3, mode: "fixture", maxCorrections: 0, maxResumes: 1 }, 201);
const waitingRoute = `/missions/${waiting.id}`;
waiting = await post(`${waitingRoute}/context`, { ...context(badSha), prNumber: 3 });
for (const phase of ["initial", "final"]) waiting = await post(`${waitingRoute}/review`, { headSha: badSha, contextHash: waiting.context.hash, phase, coverage: { complete: true, criteria: ["Returns a+b"], files: ["math.js"], limits: [] }, findings: [], simulatedActorId: "reviewer-fixture" });
waiting = await post(`${waitingRoute}/evidence`, { ...evidence, headSha: badSha, remoteHeadSha: badSha, conflict: null });
assert.equal(waiting.stage, "waiting_external");
waiting = await post(`${waitingRoute}/resume`, {});
assert.equal(waiting.stage, "readiness");
assert.equal(waiting.budgets.resumesReserved, 1);
assert.equal(Object.keys(waiting.issueIds).length, 5);
const duplicateResume = await post(`${waitingRoute}/resume`, {}, 422);
assert.match(duplicateResume.error, /Expected stage/);
outcomes.push("host resume creates one coordinator issue and reserves a finite attempt");
console.log(JSON.stringify({ result: "pass", host: api, companyId, missionId: mission.id, fixture: dir, baseSha, badSha, fixedSha, outcomes }, null, 2));
