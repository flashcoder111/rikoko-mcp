import { publicError } from "../../contracts/src/error-contract.js";

export function toolError(
  error: unknown,
  fallbackCode?: string,
  fallbackMessage?: string,
) {
  const detail = publicError(error, fallbackCode, fallbackMessage);
  // Hermes forwards text from isError results, so recovery must be present here
  // as well as in structuredContent (not only in a field the host may discard).
  return {
    isError: true,
    content: [
      { type: "text" as const, text: JSON.stringify({ error: detail }) },
    ],
    structuredContent: { error: detail },
  };
}
