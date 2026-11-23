import { describe, expect, it } from "vitest";
import { projectKeyFromRemote } from "../src/projectKey.ts";

describe("projectKeyFromRemote", () => {
  it("normalises ssh and https remotes to the same key", () => {
    expect(projectKeyFromRemote("git@github.com:admin/my-porfolio.git", "/x")).toBe(
      "github.com/admin/my-porfolio",
    );
    expect(projectKeyFromRemote("https://github.com/admin/My-Porfolio", "/x")).toBe(
      "github.com/admin/my-porfolio",
    );
  });

  it("normalises the ssh:// form", () => {
    expect(projectKeyFromRemote("ssh://git@github.com/admin/longmem.git", "/x")).toBe(
      "github.com/admin/longmem",
    );
  });

  it("falls back to the absolute path", () => {
    expect(projectKeyFromRemote(null, "/Users/admin/personal/longmem")).toBe(
      "path:/Users/admin/personal/longmem",
    );
    expect(projectKeyFromRemote("", "/Users/admin/personal/longmem")).toBe(
      "path:/Users/admin/personal/longmem",
    );
  });

  it("falls back to the path for a local remote", () => {
    expect(projectKeyFromRemote("/Users/admin/repos/thing", "/Users/admin/personal/longmem")).toBe(
      "path:/Users/admin/personal/longmem",
    );
  });

  it("strips trailing slashes and a .git suffix", () => {
    expect(projectKeyFromRemote("https://github.com/Admin/Repo.git/", "/x")).toBe("github.com/admin/repo");
  });
});
