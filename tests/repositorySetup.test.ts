import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";

describe("repository setup", () => {
  test("keeps Project Context Records adopted in AGENTS.md", async () => {
    const agents = await readFile(path.join(process.cwd(), "AGENTS.md"), "utf8");

    expect(agents).toContain("## Project Context Records (PCR)");
    expect(agents).toContain("https://github.com/hyf0/project-context-records");
    expect(agents).toContain("Records are in `.agents/docs/`");
    expect(agents).toContain("A `[VOUCHED @handle]` stamp");
  });

  test("keeps CLAUDE.md as a symlink to AGENTS.md", async () => {
    const claudePath = path.join(process.cwd(), "CLAUDE.md");
    const info = await lstat(claudePath);

    expect(info.isSymbolicLink()).toBe(true);
    expect(await readlink(claudePath)).toBe("AGENTS.md");
  });

  test("keeps durable project records under .agents/docs", async () => {
    const docsDir = path.join(process.cwd(), ".agents", "docs");
    const docsInfo = await lstat(docsDir);

    expect(docsInfo.isDirectory()).toBe(true);
    await expect(readFile(path.join(docsDir, "fuzzer-design.md"), "utf8")).resolves.toContain(
      "# Fuzzer Design Context",
    );
    await expect(readFile(path.join(docsDir, "spec-sourcing.md"), "utf8")).resolves.toContain(
      "# CSS Spec Sourcing Context",
    );
  });
});
