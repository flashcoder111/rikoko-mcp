import { join, win32 } from "node:path";

export function pythonExecutable(root: string, platform = process.platform) {
  return platform === "win32"
    ? win32.join(root, "python", ".venv", "Scripts", "python.exe")
    : join(root, "python/.venv/bin/python");
}

export function serviceLauncher(
  node: string,
  script: string,
  config: string,
  platform = process.platform,
) {
  if (platform === "win32") {
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    return {
      name: "service.ps1",
      content: `param([ValidateSet('start', 'stop', 'restart')][string]$Action = 'start')\n& ${quote(node)} --experimental-strip-types ${quote(script)} $Action ${quote(config)}\nexit $LASTEXITCODE\n`,
    };
  }
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return {
    name: "service",
    content: `#!/bin/sh\nexec ${quote(node)} --experimental-strip-types ${quote(script)} "\${1:-start}" ${quote(config)}\n`,
  };
}
