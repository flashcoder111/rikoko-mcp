import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { AppError } from "../../contracts/src/index.js";
export interface Storage {
  put(key: string, data: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  providerUrl?(key: string): Promise<string>;
}
export function safeKey(key: string) {
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(key) || key.includes(".."))
    throw new AppError("INVALID_PATH", "Invalid storage key");
  return key;
}
export const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
export class LocalStorage implements Storage {
  constructor(public root: string) {}
  path(key: string) {
    return resolve(this.root, safeKey(key));
  }
  async put(key: string, data: Uint8Array) {
    const path = this.path(key);
    await mkdir(join(path, ".."), { recursive: true });
    const tmp = path + "." + randomUUID() + ".tmp";
    try {
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, path);
    } finally {
      await rm(tmp, { force: true });
    }
  }
  async read(key: string) {
    return readFile(this.path(key));
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}
export class S3Storage implements Storage {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}
  async providerUrl(key: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
      { expiresIn: 3600 },
    );
  }
  async put(key: string, data: Uint8Array) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        Body: data,
      }),
    );
  }
  async read(key: string) {
    const r = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
    );
    return r.Body!.transformToByteArray();
  }
  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
    );
  }
}
