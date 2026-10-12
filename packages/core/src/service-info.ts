import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Service } from "./index.js";
import { cloudRequest } from "../../cloud-client/src/http.js";
const checkout = z
  .string()
  .url()
  .refine((s) => {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password;
  }, "Checkout must use HTTPS");
export const plansSchema = z
  .object({
    plans: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-zA-Z0-9_-]+$/)
              .max(80),
            name: z.string().min(1).max(80),
            description: z.string().max(300),
            priceMinor: z.number().int().positive().max(100000000),
            currency: z.enum(["USD", "CNY"]),
            allowanceCents: z.number().int().positive().max(100000000),
            features: z.array(z.string().max(100)).max(8).default([]),
            purchaseUrl: checkout,
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type PlanCatalog = z.infer<typeof plansSchema>;
export type ServiceInfo = PlanCatalog & {
  mode: "official" | "custom";
  catalogStatus: "ready" | "unconfigured" | "unavailable";
};
const settings = new WeakMap<
  Service,
  { mode: "official" | "custom"; plans: PlanCatalog; officialOrigin?: string }
>();
export const setServiceInfo = (
  service: Service,
  value: {
    mode: "official" | "custom";
    plans: PlanCatalog;
    officialOrigin?: string;
  },
) => settings.set(service, value);
export const serviceMode = (service: Service) => settings.get(service)?.mode;
export async function loadPlans(path?: string): Promise<PlanCatalog> {
  return path
    ? plansSchema.parse(JSON.parse(await readFile(path, "utf8")))
    : { plans: [] };
}
export async function publicServiceInfo(
  service: Service,
): Promise<ServiceInfo> {
  const info = settings.get(service) ?? {
    mode: "custom" as const,
    plans: { plans: [] },
  };
  if (!info.plans.plans.length && info.officialOrigin) {
    try {
      const remote = await cloudRequest(
        info.officialOrigin,
        "/v1/plans",
        fetch,
      );
      const catalog = plansSchema.parse(remote.data);
      return {
        ...catalog,
        mode: info.mode,
        catalogStatus: catalog.plans.length ? "ready" : "unconfigured",
      };
    } catch {
      return { plans: [], mode: info.mode, catalogStatus: "unavailable" };
    }
  }
  return {
    ...info.plans,
    mode: info.mode,
    catalogStatus: info.plans.plans.length ? "ready" : "unconfigured",
  };
}
