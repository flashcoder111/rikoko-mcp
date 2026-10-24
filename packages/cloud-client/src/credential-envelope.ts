import { spawn } from "node:child_process";

// Unix credentials are protected by owner-only files. Windows additionally uses
// DPAPI CurrentUser because POSIX file modes do not enforce Windows ACLs.
export async function credentialEnvelope(
  value: unknown,
  decrypt = false,
  platform = process.platform,
): Promise<unknown> {
  if (platform !== "win32") return value;
  const encrypted = value as { protection?: string; data?: string };
  if (
    decrypt &&
    (encrypted?.protection !== "windows-dpapi" ||
      typeof encrypted.data !== "string" ||
      !/^[A-Za-z0-9+/=]+$/.test(encrypted.data))
  )
    throw Error("Invalid Windows credential envelope");
  const script = decrypt
    ? "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))"
    : "Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); $p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($p))";
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference='Stop'; " + script,
      ],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdin.on("error", () => {});
    child.stdin.end(decrypt ? encrypted.data : JSON.stringify(value));
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("Credential protection timed out"));
    }, 10000);
    timer.unref();
    child.once("error", () => {
      clearTimeout(timer);
      reject(Error("Credential protection unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || size > 1024 * 1024)
        reject(Error("Credential protection failed"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
  return decrypt
    ? JSON.parse(result)
    : { protection: "windows-dpapi", data: result.trim() };
}
