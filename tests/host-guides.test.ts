import { createHash } from "node:crypto";
import {
  readFile,
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMcpServer } from "../packages/mcp/src/index.js";
import { guideTopics } from "../packages/mcp/src/guides.js";
import {
  installManagedSkill,
  requiredSkillReferences,
} from "../packages/bootstrap/src/skill-files.js";

it.each(["codex", "claude", "hermes", "generic"] as const)(
  "%s reads the complete bundled guides through MCP without file tools or backend calls",
  async (host) => {
    const invoke = vi.fn(async () => {
      throw Error("Unexpected backend call");
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
      expect(list.tools.some((t) => t.name === "asset_import_file")).toBe(
        false,
      );
      expect(client.getServerCapabilities()?.resources).toBeUndefined();
      for (const topic of guideTopics) {
        const expected = await readFile(
          resolve(
            "skills/rikoko",
            topic === "overview" ? "SKILL.md" : `references/${topic}.md`,
          ),
          "utf8",
        );
        const result = await client.callTool({
          name: "rikoko_guide",
          arguments: { topic },
        });
        expect(result.isError).not.toBe(true);
        expect(result.content).toEqual([{ type: "text", text: expected }]);
        expect(result.structuredContent).toEqual({
          result: {
            topic,
            markdown: expected,
            configuredHost: host,
            availableTopics: [...guideTopics],
            sha256: createHash("sha256").update(expected).digest("hex"),
          },
        });
      }
      for (const args of [
        { topic: "../../.env" },
        { topic: "host-unknown" },
        { topic: "overview", path: "/tmp/secret" },
      ]) {
        const result = await client.callTool({
          name: "rikoko_guide",
          arguments: args,
        });
        expect(result.isError).toBe(true);
      }
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  },
);

it("every entrypoint reference is retrievable as a guide and ships in runtime packaging", async () => {
  const skill = await readFile(resolve("skills/rikoko/SKILL.md"), "utf8");
  const topics = requiredSkillReferences(skill).map((p) =>
    p.replace(/^references\//, "").replace(/\.md$/, ""),
  );
  expect(topics.sort()).toEqual(
    guideTopics.filter((t) => t !== "overview").sort(),
  );
  const { stdout } = await promisify(execFile)(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: resolve("."),
      maxBuffer: 10_000_000,
    },
  );
  const [pack] = JSON.parse(stdout);
  const files = pack.files.map((f: { path: string }) => f.path);
  for (const path of ["SKILL.md", ...requiredSkillReferences(skill)])
    expect(files).toContain(`skills/rikoko/${path}`);
}, 30000);

it("skill-only updates protect unmanaged skills and refuse incomplete bundles before changing references", async () => {
  const root = await mkdtemp(join(tmpdir(), "rikoko-skill-update-"));
  const source = join(root, "source"),
    dest = join(root, "dest");
  try {
    await mkdir(join(source, "references"), { recursive: true });
    await mkdir(join(dest, "references"), { recursive: true });
    const skill =
      "<!-- Managed by the rikoko installer. -->\n[Host](references/host-codex.md)\n";
    await writeFile(join(source, "SKILL.md"), skill);
    await writeFile(join(dest, "SKILL.md"), "personal skill");
    await writeFile(
      join(dest, "references/host-codex.md"),
      "existing reference",
    );
    await expect(installManagedSkill(source, dest)).rejects.toThrow(
      "missing or invalid",
    );
    await writeFile(join(source, "references/host-codex.md"), "new reference");
    await expect(installManagedSkill(source, dest)).rejects.toThrow(
      "different rikoko skill",
    );
    expect(await readFile(join(dest, "references/host-codex.md"), "utf8")).toBe(
      "existing reference",
    );
    await writeFile(
      join(dest, "SKILL.md"),
      "<!-- Managed by the rikoko installer. -->\nold content",
    );
    await installManagedSkill(source, dest);
    expect(await readFile(join(dest, "SKILL.md"), "utf8")).toBe(skill);
    const files = await readdir(dest);
    expect(files.filter((f) => f.endsWith(".bak"))).toHaveLength(1);
    expect((await installManagedSkill(source, dest)).updated).toBe(false);
    expect(await readdir(dest)).toEqual(files);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  ["codex", ".codex"],
  ["claude-code", ".claude"],
  ["hermes", ".hermes"],
])(
  "sync-skill %s works without credentials, backend, or a host configuration",
  async (host, folder) => {
    const home = await mkdtemp(join(tmpdir(), "rikoko-skill-cli-"));
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          resolve("node_modules/tsx/dist/loader.mjs"),
          resolve("scripts/clients.ts"),
          "sync-skill",
          host,
        ],
        {
          env: {
            PATH: process.env.PATH,
            VIDEOWORKBENCH_CLIENT_HOME: home,
            // Any accidental backend initialization would fail before skill installation.
            VIDEOWORKBENCH_MANAGED_CONFIG: join(home, "does-not-exist.json"),
            VIDEOWORKBENCH_URL: "invalid-origin",
          },
        },
      );
      expect(JSON.parse(stdout).updated).toBe(true);
      expect(await readdir(home)).toEqual([folder]);
      expect(await readdir(join(home, folder))).toEqual(["skills"]);
      const original = await readFile(
        resolve("skills/rikoko/SKILL.md"),
        "utf8",
      );
      expect(
        await readFile(join(home, folder, "skills/rikoko/SKILL.md"), "utf8"),
      ).toBe(original);
      for (const ref of requiredSkillReferences(original))
        expect(
          await readFile(join(home, folder, "skills/rikoko", ref), "utf8"),
        ).toBe(await readFile(resolve("skills/rikoko", ref), "utf8"));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
