import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { Database } from "../../../packages/db/src/index.js";
import {
  LocalStorage,
  S3Storage,
} from "../../../packages/storage/src/index.js";
import {
  FalProvider,
  type Model,
} from "../../../packages/providers/src/index.js";
import { h3Models } from "../../../packages/providers/src/h3.js";
import { seedanceMiniModels } from "../../../packages/providers/src/seedance-mini.js";
import { klingO3Models } from "../../../packages/providers/src/kling-o3.js";
import { audioModels } from "../../../packages/providers/src/audio.js";
import { expandedModels } from "../../../packages/providers/src/expanded-models.js";
import { latestModels } from "../../../packages/providers/src/latest-models.js";
import {
  loadModelConfig,
  buildProviders,
} from "../../../packages/providers/src/config.js";
import {
  loadPlans,
  setServiceInfo,
} from "../../../packages/core/src/service-info.js";
import { Service } from "../../../packages/core/src/index.js";
import { connectServices } from "../../../packages/cloud-client/src/index.js";
import { resolveCloudConfig } from "../../../packages/cloud-client/src/config.js";
import {
  AccountConnection,
  registerAccountConnection,
} from "../../../packages/cloud-client/src/account-connection.js";
export async function openRuntime() {
  const config = process.env.RIKOKO_CONFIG_FILE
    ? await loadModelConfig(process.env.RIKOKO_CONFIG_FILE)
    : undefined;
  const cloudConfig = resolveCloudConfig(config);
  const { mode } = cloudConfig;
  const plans = await loadPlans(process.env.RIKOKO_PLANS_FILE);
  let models: Model[] = [
    ...seedanceMiniModels,
    ...h3Models,
    ...klingO3Models,
    ...audioModels,
    ...latestModels,
    ...expandedModels,
  ];
  if (!config && process.env.FAL_MODELS_FILE)
    models = JSON.parse(await readFile(process.env.FAL_MODELS_FILE, "utf8"));
  const dataDir = resolve(process.env.DATA_DIR ?? ".data");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const db = await Database.open(
    resolve(dataDir, "db"),
    process.env.DATABASE_URL,
  );
  const storage = process.env.S3_BUCKET
    ? new S3Storage(
        new S3Client({
          region: process.env.S3_REGION ?? "auto",
          endpoint: process.env.S3_ENDPOINT,
          forcePathStyle: true,
        }),
        process.env.S3_BUCKET,
      )
    : new LocalStorage(resolve(dataDir, "assets"));
  const service = new Service(
    db,
    storage,
    config
      ? buildProviders(config)
      : new FalProvider(
          models,
          mode === "official" ? undefined : process.env.FAL_KEY,
          mode === "custom" && process.env.ENABLE_PAID_PROVIDERS === "true",
        ),
    mode === "custom" ? "external" : "credits",
  );
  service.localVideoDownloads =
    !process.env.DATABASE_URL &&
    storage instanceof LocalStorage &&
    ["127.0.0.1", "localhost", "::1"].includes(process.env.HOST ?? "127.0.0.1");
  setServiceInfo(service, {
    mode,
    plans,
    officialOrigin: cloudConfig.gatewayOrigin,
  });
  if (cloudConfig.templateOrigin || cloudConfig.gatewayOrigin)
    connectServices(service, cloudConfig);
  if (!process.env.DATABASE_URL) {
    const accounts = await db.transaction((tx) =>
      tx.query("SELECT id FROM accounts LIMIT 1"),
    );
    if (!accounts.rows.length) {
      const account = await service.createAccount("Local workspace", 0);
      await writeFile(resolve(dataDir, "local-admin.key"), account.key + "\n", {
        mode: 0o600,
      });
      await chmod(resolve(dataDir, "local-admin.key"), 0o600);
      console.error(
        `Local API key saved to ${resolve(dataDir, "local-admin.key")}`,
      );
    }
  }
  if (service.localVideoDownloads) {
    const owner = await db.transaction(
      async (tx) =>
        (
          await tx.query(
            "SELECT account_id AS id FROM api_keys ORDER BY created_at,id LIMIT 1",
          )
        ).rows[0],
    );
    if (!owner) throw new Error("Local account owner is missing");
    const connection = new AccountConnection({
      directory: resolve(dataDir, "account"),
      website: process.env.RIKOKO_ACCOUNT_WEBSITE_URL ?? "https://rikoko.ai",
      activate: ({ apiOrigin, id, token }) => {
        service.billingSource = "credits";
        setServiceInfo(service, {
          mode: "official",
          plans,
          officialOrigin: apiOrigin,
        });
        connectServices(service, {
          templateOrigin: cloudConfig.templateOrigin,
          gatewayOrigin: apiOrigin,
          gatewayKey: { id, ownerAccountId: owner.id, token },
        });
      },
    });
    await connection.restore();
    registerAccountConnection(service, connection);
  }
  return { db, service, dataDir };
}
