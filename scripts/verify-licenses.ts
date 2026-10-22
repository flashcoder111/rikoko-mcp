import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { starterTemplates } from "../packages/templates/src/starters.js";
import { exportPublicSource } from "./export-public.js";

const root = resolve(".");
const run = promisify(execFile);
const sha = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
const output = resolve(
  process.env.RIKOKO_LICENSE_REPORT_DIR ?? "artifacts/license-review",
);
await mkdir(output, { recursive: true });
const write = process.argv.includes("--write-notices");
type Dependency = {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  homepage?: string;
};
const dependencies = JSON.parse(
  (
    await run("pnpm", ["licenses", "list", "--prod", "--json"], {
      maxBuffer: 10_000_000,
    })
  ).stdout,
) as Record<string, Dependency[]>;
const notices: string[] = [
  "rikoko third-party notices — installed production dependencies\n\nGenerated from pinned package metadata and included license texts.\nSource installer downloads dependencies separately. This file does not authorize redistributing FFmpeg, Python wheels, or a container image.\n",
];
const inventory: object[] = [];
for (const dep of Object.values(dependencies)
  .flat()
  .sort((a, b) => a.name.localeCompare(b.name))) {
  for (const path of dep.paths) {
    const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    const texts: Array<{ file: string; text: string }> = [];
    for (const name of (await readdir(path)).sort()) {
      if (/^(license|licence|copying|notice|copyright)([.-]|$)/i.test(name))
        texts.push({
          file: name,
          text: await readFile(join(path, name), "utf8"),
        });
    }
    if (!texts.length && ["pg-types", "pgpass"].includes(dep.name)) {
      const readme = await readFile(join(path, "README.md"), "utf8");
      const start = readme.search(/^## license\s*$/im);
      if (start >= 0)
        texts.push({ file: "README.md#license", text: readme.slice(start) });
    }
    if (
      !texts.length &&
      dep.name.startsWith("@aws-sdk/") &&
      dep.license === "Apache-2.0"
    )
      texts.push({
        file: "@aws-sdk/client-s3/LICENSE (same upstream aws/aws-sdk-js-v3 repository)",
        text: await readFile("node_modules/@aws-sdk/client-s3/LICENSE", "utf8"),
      });
    if (!texts.length || /unknown|unlicensed/i.test(dep.license))
      throw Error(`Unreviewed dependency license: ${dep.name}@${pkg.version}`);
    inventory.push({
      ecosystem: "npm",
      name: dep.name,
      version: pkg.version,
      license: dep.license,
      homepage: dep.homepage,
      notices: texts.map((t) => ({ file: t.file, sha256: sha(t.text) })),
    });
    notices.push(
      `\n===== ${dep.name}@${pkg.version} (${dep.license}) =====\n` +
        texts.map((t) => `\n--- ${t.file} ---\n${t.text}`).join("\n"),
    );
  }
}
const python = JSON.parse(
  (
    await run(
      join(root, "python/.venv/bin/python"),
      [
        "-c",
        `
import json
from importlib.metadata import distributions
result=[]
for d in sorted(distributions(),key=lambda d:d.metadata['Name'].lower()):
    texts=[]
    for f in sorted(d.files or [],key=str):
        if str(f).rsplit('/',1)[-1].lower().startswith(('license','copying','notice','copyright')):
            texts.append({'file':str(f),'text':d.locate_file(f).read_text()})
    result.append({'ecosystem':'pypi','name':d.metadata['Name'],'version':d.version,'license':d.metadata.get('License-Expression') or d.metadata.get('License'),'notices':texts})
print(json.dumps(result))
`,
      ],
      { maxBuffer: 10_000_000 },
    )
  ).stdout,
);
for (const dep of python) {
  if (!dep.license || !dep.notices.length)
    throw Error(`Missing Python license: ${dep.name}`);
  notices.push(
    `\n===== ${dep.name}@${dep.version} (${dep.license}) =====\n` +
      dep.notices
        .map(
          (t: { file: string; text: string }) =>
            `\n--- ${t.file} ---\n${t.text}`,
        )
        .join("\n"),
  );
  inventory.push({
    ...dep,
    notices: dep.notices.map((t: { file: string; text: string }) => ({
      file: t.file,
      sha256: sha(t.text),
    })),
  });
}
const fonts = JSON.parse(
  await readFile("packages/render/fonts/manifest.json", "utf8"),
).fonts;
const media = [];
for (const font of fonts) {
  const path = `packages/render/fonts/${font.file}`;
  if (sha(await readFile(path)) !== font.sha256)
    throw Error(`Font hash mismatch: ${path}`);
  const licenseText = await readFile(
    `packages/render/fonts/${font.license}`,
    "utf8",
  );
  if (!licenseText.includes("SIL OPEN FONT LICENSE"))
    throw Error(`Font license missing: ${path}`);
  media.push({
    path,
    sha256: font.sha256,
    license: "OFL-1.1",
    source: font.source,
    notice: `packages/render/fonts/${font.license}`,
  });
}
const bundled = "packages/templates/src/bundled";
const art = JSON.parse(await readFile(`${bundled}/manifest.json`, "utf8"));
for (const item of art) {
  const path = `${bundled}/${item.file}`;
  if (sha(await readFile(path)) !== item.sha256)
    throw Error(`Artwork hash mismatch: ${path}`);
  media.push({
    path,
    sha256: item.sha256,
    license: "Apache-2.0",
    source: "scripts/build-starter-art.py",
    font: "packages/render/fonts/NotoSansSC.ttf",
  });
}
for (const template of starterTemplates) {
  const path = `${bundled}/previews/${template.id}.mp4`;
  media.push({
    path,
    sha256: sha(await readFile(path)),
    license: "Apache-2.0",
    source: "scripts/build-starter-previews.ts",
    font: "packages/render/fonts/NotoSansSC.ttf",
    audio: "none",
  });
}
const expected = new Set(media.map((m) => m.path));
for (const dir of [bundled, `${bundled}/previews`])
  for (const file of await readdir(dir))
    if (
      /\.(png|mp4|jpg|webp|mp3|wav)$/i.test(file) &&
      !expected.has(`${dir}/${file}`)
    )
      throw Error(`Unreviewed bundled media: ${dir}/${file}`);
for (const file of [
  "01-start.png",
  "02-result.png",
  "03-editor.png",
  "04-versions.png",
]) {
  const path = `docs/tutorials/images/${file}`;
  media.push({
    path,
    sha256: sha(await readFile(path)),
    license: "Apache-2.0",
    source:
      "2026-10-21 actual local rikoko UI capture; synthetic host acceptance project using original product-stage.png; no user media",
  });
}
const temporary = await mkdtemp(join(tmpdir(), "rikoko-license-source-"));
try {
  const exported = await exportPublicSource(root, join(temporary, "source"));
  const reviewed = new Set(media.map((m) => m.path));
  for (const path of exported.files) {
    const bytes = await readFile(join(exported.directory, path));
    if (
      (bytes.includes(0) ||
        /\.(svg|png|jpe?g|webp|gif|mp4|mp3|wav|woff2?|ttf|otf|wasm)$/i.test(
          path,
        )) &&
      !reviewed.has(path)
    )
      throw Error(`Unreviewed binary/media in public archive: ${path}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
const mediaJson =
  JSON.stringify(
    { schemaVersion: 1, scope: "source-installer", files: media },
    null,
    2,
  ) + "\n";
const noticeText = notices.join("\n");
if (write) {
  await writeFile("THIRD_PARTY_LICENSES.txt", noticeText);
  await writeFile("docs/integrations/media-licenses.json", mediaJson);
} else {
  if ((await readFile("THIRD_PARTY_LICENSES.txt", "utf8")) !== noticeText)
    throw Error(
      "Third-party notices are stale; review dependency changes before --write-notices",
    );
  if (
    (await readFile("docs/integrations/media-licenses.json", "utf8")) !==
    mediaJson
  )
    throw Error(
      "Bundled media license inventory is stale; review provenance before --write-notices",
    );
}
const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  scope: "source-installer",
  checksPassed: true,
  binaryRedistributionApproved: false,
  lockfiles: Object.fromEntries(
    await Promise.all(
      ["pnpm-lock.yaml", "python/uv.lock"].map(async (path) => [
        path,
        sha(await readFile(path)),
      ]),
    ),
  ),
  dependencies: inventory,
  media,
  obligations: [
    "Preserve LICENSE, THIRD_PARTY_NOTICES.md, THIRD_PARTY_LICENSES.txt and bundled font OFL notices.",
    "mutagen: GPL-2.0-or-later; certifi: MPL-2.0. Downloaded on the user's machine, not vendored in source archive.",
    "FFmpeg/libx264, curl_cffi native libraries, Pillow wheel libraries and PGlite/PostgreSQL need additional corresponding-source and bundled-library review before distributing binary environments.",
    "This inventory checks recorded provenance, not ownership of unrecorded external contributions or user-imported media.",
  ],
};
await writeFile(
  join(output, "dependency-licenses.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    dependencies: inventory.length,
    media: media.length,
    checksPassed: true,
    scope: report.scope,
    report: join(output, "dependency-licenses.json"),
  }),
);
