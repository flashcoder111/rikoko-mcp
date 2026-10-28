import { expect, it, vi } from "vitest";
import { readFile, mkdtemp, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMcpServer } from "../packages/mcp/src/index.js";
import { guideTopics } from "../packages/guidance/src/catalog.js";
import {
  readGuide,
  guideCapabilities,
  validateGuideBundle,
} from "../packages/guidance/src/reader.js";
import { checkDirectorGuides } from "../packages/guidance/src/doctor.js";
import { tools } from "../packages/mcp/src/tools.js";
const exec = promisify(execFile);
it.each(["codex", "claude", "hermes", "generic"] as const)(
  "%s reads every topic through the backend without a local Skill",
  async (host) => {
    const invoke = vi.fn(async (name: string, input: unknown) => {
      if (name !== "rikoko_guide") throw Error("No generation or other calls");
      return readGuide(input);
    });
    const server = createMcpServer(invoke, { client: host });
    const client = new Client({ name: "guide-test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    try {
      const list = await client.listTools();
      expect(
        list.tools.find((t) => t.name === "rikoko_guide")?.annotations,
      ).toMatchObject({
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      });
      for (const topic of guideTopics) {
        const result = await client.callTool({
          name: "rikoko_guide",
          arguments: { topic },
        });
        const expected = await readGuide({ topic });
        expect(result.isError).not.toBe(true);
        expect(result.content).toEqual([
          {
            type: "text",
            text: [expected.markdown, expected.navigationMarkdown]
              .filter(Boolean)
              .join("\n\n"),
          },
        ]);
        expect(result.structuredContent).toEqual({
          result: { ...expected, configuredHost: host },
        });
      }
      const count = invoke.mock.calls.length;
      for (const args of [
        { topic: "../../.env" },
        { topic: "host-unknown" },
        { topic: "overview", path: "/tmp/secret" },
      ])
        expect(
          (await client.callTool({ name: "rikoko_guide", arguments: args }))
            .isError,
        ).toBe(true);
      expect(invoke).toHaveBeenCalledTimes(count);
    } finally {
      await client.close();
      await server.close();
    }
  },
);
it("doctor validates all topics and fails missing, corrupt and incompatible guides", async () => {
  const caps = { directorGuides: await guideCapabilities() },
    names = Object.keys(tools);
  for (const missing of ["video_model_resolve", "task_usage"]) {
    await expect(
      checkDirectorGuides(
        names.filter((name) => name !== missing),
        caps,
        (_, args) => readGuide(args),
      ),
    ).rejects.toThrow("unsupported");
  }
  expect(
    await checkDirectorGuides(names, caps, (_, args) => readGuide(args)),
  ).toMatchObject({
    available: true,
    skillRequired: false,
    topics: guideTopics.length,
  });
  await expect(
    checkDirectorGuides([], caps, (_, args) => readGuide(args)),
  ).rejects.toThrow("unavailable");
  await expect(
    checkDirectorGuides(names, caps, async (_, args) => ({
      ...(await readGuide(args)),
      markdown: "tampered",
    })),
  ).rejects.toThrow("verification");
  await expect(
    checkDirectorGuides(names, caps, async (_, args) => ({
      ...(await readGuide(args)),
      requiredTools: ["future_tool"],
    })),
  ).rejects.toThrow("unsupported");
  const mismatch = {
    directorGuides: { ...caps.directorGuides, protocol: "future" },
  };
  await expect(
    checkDirectorGuides(names, mismatch, (_, args) => readGuide(args)),
  ).rejects.toThrow("incompatible");
});
it("the actual runtime archive carries all guides and no independently installed Skill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "guide-package-"));
  try {
    const { stdout } = await exec(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", dir],
      { cwd: resolve("."), maxBuffer: 10_000_000 },
    );
    const [pack] = JSON.parse(stdout);
    expect(
      pack.files.some((f: any) => f.path.startsWith("skills/rikoko")),
    ).toBe(false);
    await exec("tar", ["-xzf", join(dir, pack.filename), "-C", dir]);
    await validateGuideBundle(join(dir, "package/packages/guidance"));
    await symlink(resolve("node_modules"), join(dir, "package/node_modules"));
    const { stdout: result } = await exec(
      resolve("node_modules/.bin/tsx"),
      [
        "-e",
        "import {readGuide} from './packages/guidance/src/reader.ts'; import {guideTopics} from './packages/guidance/src/catalog.ts'; (async()=>{for(const topic of guideTopics) await readGuide({topic});console.log('all topics readable')})();",
      ],
      { cwd: join(dir, "package") },
    );
    expect(result).toContain("all topics readable");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
it.each(["codex", "claude-code", "hermes"])(
  "deprecated sync-skill %s changes no host files",
  async (host) => {
    const home = await mkdtemp(join(tmpdir(), "no-skill-"));
    try {
      const { stdout } = await exec(
        process.execPath,
        ["--import", "tsx", "scripts/clients.ts", "sync-skill", host],
        {
          cwd: resolve("."),
          env: { ...process.env, VIDEOWORKBENCH_CLIENT_HOME: home },
        },
      );
      expect(stdout).toContain("No files changed");
      await expect(
        readFile(
          join(
            home,
            host === "codex"
              ? ".codex"
              : host === "hermes"
                ? ".hermes"
                : ".claude",
            "skills/rikoko/SKILL.md",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
