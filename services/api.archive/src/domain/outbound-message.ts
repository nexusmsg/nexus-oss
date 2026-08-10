/**
 * Outbound WABA message domain type and parser. Pure TS — no Hono / Supabase
 * imports.
 *
 * The validation rules mirror `validateOutboundMessage` in
 * `services/worker/internal/service/outbound.go`, including the order of
 * checks and the exact error messages.
 */

import { ValidationError } from "./errors.js";

export interface OutboundMessage {
  messaging_product: "whatsapp";
  type: "text";
  to: string;
  text: { body: string };
  category?: string;
}

const SUPPORTED_CATEGORIES = new Set(["utility", "authentication", "service"]);

/**
 * Validate and normalize an unknown request body into an `OutboundMessage`.
 * Throws `ValidationError` with the exact WABA validation message on any
 * violation.
 */
export function parseOutboundMessage(body: unknown): OutboundMessage {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Invalid request body");
  }
  const record = body as Record<string, unknown>;

  if (record.messaging_product !== "whatsapp") {
    throw new ValidationError("messaging_product must be whatsapp");
  }
  const messageType = typeof record.type === "string" ? record.type : "";
  if (messageType !== "text") {
    throw new ValidationError(`message type "${messageType}" is not supported`);
  }
  const text = record.text;
  const textBody =
    text !== null && typeof text === "object"
      ? (text as Record<string, unknown>).body
      : undefined;
  if (typeof textBody !== "string" || textBody.trim() === "") {
    throw new ValidationError("text.body is required");
  }
  if (typeof record.to !== "string" || record.to === "") {
    throw new ValidationError("to is required");
  }
  const category = record.category;
  if (
    category !== undefined &&
    category !== "" &&
    (typeof category !== "string" || !SUPPORTED_CATEGORIES.has(category))
  ) {
    throw new ValidationError("category must be utility, authentication, or service");
  }

  return {
    messaging_product: "whatsapp",
    type: "text",
    to: record.to,
    text: { body: textBody },
    category: typeof category === "string" ? category : undefined,
  };
}
