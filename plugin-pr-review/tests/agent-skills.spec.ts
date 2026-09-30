import { describe, expect, it } from "vitest";
import manifest, { ROLES, SKILL_KEYS } from "../src/manifest.js";

const roleMethod = {
  coordinator: "pr-review-coordination",
  reviewer: "pr-review-code-review",
  fixer: "pr-review-remediation",
} as const;

describe("managed agent instruction layers", () => {
  it("keeps each AGENTS.md a role charter and declares its reusable method", () => {
    expect(manifest.agents?.map(agent => agent.agentKey)).toEqual([...ROLES]);
    for (const agent of manifest.agents ?? []) {
      const role = agent.agentKey as keyof typeof roleMethod;
      const instructions = agent.instructions;
      expect(instructions?.entryFile).toBe("AGENTS.md");
      expect(instructions?.content).toContain("pr-review-workflow");
      expect(instructions?.content).toContain(roleMethod[role]);
      expect(instructions?.content).not.toContain("POST /api/plugins/");
    }
  });

  it("declares one shared protocol and three distinct role skills", () => {
    expect(manifest.skills?.map(skill => skill.skillKey)).toEqual([...SKILL_KEYS]);
    for (const skill of manifest.skills ?? []) {
      expect(skill.markdown).toMatch(/^---\nname: /);
      expect(skill.markdown).toContain("description: Use ");
    }
    expect(manifest.skills?.find(skill => skill.skillKey === "pr-review-coordination")?.markdown).toContain("/missions/{id}/context");
    expect(manifest.skills?.find(skill => skill.skillKey === "pr-review-code-review")?.markdown).toContain("/missions/{id}/review");
    expect(manifest.skills?.find(skill => skill.skillKey === "pr-review-remediation")?.markdown).toContain("/missions/{id}/intent");
  });
});
