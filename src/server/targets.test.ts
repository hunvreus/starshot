import { describe, expect, it } from "vitest";
import { normalizeTarget, targetLabel } from "./target-utils";

describe("targets", () => {
  it("normalizes repository stargazer targets", () => {
    expect(normalizeTarget("repo_stargazers", " openai/codex ")).toBe("openai/codex");
    expect(targetLabel("repo_stargazers", "openai/codex")).toBe("openai/codex");
  });

  it("normalizes follower targets", () => {
    expect(normalizeTarget("user_followers", "hunvreus")).toBe("hunvreus");
    expect(targetLabel("user_followers", "hunvreus")).toBe("hunvreus");
  });

  it("rejects invalid target values", () => {
    expect(() => normalizeTarget("repo_stargazers", "openai")).toThrow("owner/repo");
    expect(() => normalizeTarget("user_followers", "bad/name")).toThrow("GitHub username");
  });
});
