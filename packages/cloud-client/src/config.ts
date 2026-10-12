import type { ModelConfig } from "../../providers/src/config.js";
import { cloudOrigin } from "./http.js";

/** Template distribution never selects a paid generation route. Explicit routes fail closed. */
export function resolveCloudConfig(
  config?: ModelConfig,
  env: NodeJS.ProcessEnv = process.env,
) {
  const legacyGateway =
    env.CLOUD_API_URL && env.CLOUD_API_KEY ? env.CLOUD_API_URL : undefined;
  const mode =
    config?.mode ??
    (env.GENERATION_API_URL || legacyGateway ? "official" : "custom");
  const gatewayOrigin =
    mode === "official"
      ? config?.mode === "official"
        ? config.official.url
        : env.GENERATION_API_URL || legacyGateway
      : undefined;
  const gatewayKey =
    mode === "official"
      ? config?.mode === "official"
        ? env[config.official.keyEnv]
        : env.GENERATION_API_URL
          ? env.GENERATION_API_KEY
          : env.CLOUD_API_KEY
      : undefined;
  const templateOrigin =
    config?.templates === false
      ? undefined
      : config?.templates?.url ||
        env.TEMPLATE_API_URL ||
        env.CLOUD_API_URL ||
        gatewayOrigin;
  // Validate before creating local state. Keys are never sent to the template origin.
  return {
    mode,
    templateOrigin: templateOrigin ? cloudOrigin(templateOrigin) : undefined,
    gatewayOrigin: gatewayOrigin ? cloudOrigin(gatewayOrigin) : undefined,
    gatewayKey,
  };
}
