import { setProductionSynchronizer } from "../../core/src/production-scope.js";
import type { Service } from "../../core/src/index.js";
import { TemplateClient } from "./templates.js";
import { GatewayClient, type GatewayCredential } from "./gateway.js";
const connections = new WeakMap<
  Service,
  { templates?: TemplateClient; gateway?: GatewayClient }
>();
export function connectServices(
  service: Service,
  config: {
    templateOrigin?: string;
    gatewayOrigin?: string;
    gatewayKey?: GatewayCredential;
  },
  fetcher: typeof fetch = fetch,
) {
  const value = {
    templates: config.templateOrigin
      ? new TemplateClient(service, config.templateOrigin, fetcher)
      : undefined,
    gateway:
      config.gatewayOrigin && config.gatewayKey
        ? new GatewayClient(
            service,
            config.gatewayOrigin,
            config.gatewayKey,
            fetcher,
          )
        : undefined,
  };
  connections.set(service, value);
  setProductionSynchronizer(
    service,
    value.gateway
      ? (tx, c, kind, record) =>
          value.gateway!.syncProductionChange(tx, c, kind, record)
      : undefined,
  );
  return value;
}
export function connectCloud(
  service: Service,
  origin: string,
  key?: string,
  fetcher: typeof fetch = fetch,
) {
  return connectServices(
    service,
    { templateOrigin: origin, gatewayOrigin: origin, gatewayKey: key },
    fetcher,
  );
}
export const cloudConnection = (service: Service) => connections.get(service);
