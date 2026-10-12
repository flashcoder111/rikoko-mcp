import { AppError } from "../../contracts/src/index.js";
export function publicBaseUrl() {
  const base = new URL(
    process.env.PUBLIC_BASE_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 4310}`,
  );
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw new AppError(
      "INVALID_CONFIG",
      "PUBLIC_BASE_URL must be an HTTP(S) service URL",
      503,
    );
  return base.href.replace(/\/$/, "");
}
