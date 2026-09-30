import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("retries adapter synchronization with empty add, preserving saved keys and pins", async () => {
  const roles = ["coordinator", "reviewer", "fixer"];
  const keys = ["pr-review-workflow", "pr-review-coordination", "pr-review-code-review", "pr-review-remediation"];
  const methods = [keys[1], keys[2], keys[3]];
  const repaired = new Set<string>();
  const writes: Array<{ role: string; body: unknown }> = [];
  const pin = "11111111-1111-4111-8111-111111111111";
  const server = createServer(async (req, res) => {
    let data: unknown;
    if (req.url === "/api/health") data = { status: "ok" };
    else if (req.url === "/api/companies/company") data = { id: "company" };
    else if (req.url?.includes("/api/resources?")) data = {
      agents: Object.fromEntries(roles.map(role => [role, { agentId: role, agent: { status: "idle" } }])),
      skills: Object.fromEntries(keys.map(key => [key, { skillId: key, skill: { key }, defaultDrift: null }]))
    };
    else {
      const role = req.url?.split("/")[3] ?? "";
      const required = [keys[0], methods[roles.indexOf(role)]];
      if (req.method === "POST") {
        let body = ""; for await (const chunk of req) body += chunk;
        writes.push({ role, body: JSON.parse(body) }); repaired.add(role);
      }
      data = { supported: true, mode: "persistent", desiredSkills: [...required, "custom"], desiredSkillEntries: [{ key: keys[0], versionId: pin }], warnings: [], entries: required.map(key => ({ key, state: repaired.has(role) ? "installed" : "missing" })) };
    }
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const script = fileURLToPath(new URL("../bin/pr-review.mjs", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [script, "sync-skills", "--api", `http://127.0.0.1:${address.port}`, "--company", "company"], { env: { ...process.env, PAPERCLIP_API_KEY: "" } });
    expect(JSON.parse(stdout).after.coordinator.states.every((entry: { state: string }) => entry.state === "installed")).toBe(true);
    expect(writes).toEqual(roles.map(role => ({ role, body: { mode: "add", desiredSkills: [] } })));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
