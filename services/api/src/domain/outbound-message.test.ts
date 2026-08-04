import { describe, expect, it } from "vitest";
import { ValidationError } from "./errors.js";
import { parseOutboundMessage } from "./outbound-message.js";

const VALID_BODY = {
  messaging_product: "whatsapp",
  to: "62812345678",
  type: "text",
  text: { body: "hello world" },
};

describe("parseOutboundMessage", () => {
  it("parses a valid full message", () => {
    expect(parseOutboundMessage(VALID_BODY)).toEqual({
      messaging_product: "whatsapp",
      type: "text",
      to: "62812345678",
      text: { body: "hello world" },
    });
  });

  it("throws ValidationError when messaging_product is missing/invalid", () => {
    const body = { ...VALID_BODY, messaging_product: "sms" };
    expect(() => parseOutboundMessage(body)).toThrow(ValidationError);
    expect(() => parseOutboundMessage(body)).toThrow("messaging_product must be whatsapp");
  });

  it("throws ValidationError on an unsupported type", () => {
    const body = { ...VALID_BODY, type: "image" };
    expect(() => parseOutboundMessage(body)).toThrow(ValidationError);
    expect(() => parseOutboundMessage(body)).toThrow('message type "image" is not supported');
  });

  it("throws ValidationError when type is missing (empty string)", () => {
    const body = { ...VALID_BODY, type: undefined };
    expect(() => parseOutboundMessage(body)).toThrow(ValidationError);
    expect(() => parseOutboundMessage(body)).toThrow('message type "" is not supported');
  });

  it("throws ValidationError when text.body is missing", () => {
    const body = { ...VALID_BODY, text: undefined };
    expect(() => parseOutboundMessage(body)).toThrow(ValidationError);
    expect(() => parseOutboundMessage(body)).toThrow("text.body is required");
  });

  it("throws ValidationError when text.body is blank", () => {
    const body = { ...VALID_BODY, text: { body: "   " } };
    expect(() => parseOutboundMessage(body)).toThrow(ValidationError);
    expect(() => parseOutboundMessage(body)).toThrow("text.body is required");
  });

  it("throws ValidationError when to is missing", () => {
    const body = { ...VALID_BODY, to: undefined };
    expect(() => parseOutboundMessage(body)).toThrow(ValidationError);
    expect(() => parseOutboundMessage(body)).toThrow("to is required");
  });

  it("throws ValidationError on an invalid category", () => {
    const body = { ...VALID_BODY, category: "marketing" };
    expect(() => parseOutboundMessage(body)).toThrow(ValidationError);
    expect(() => parseOutboundMessage(body)).toThrow(
      "category must be utility, authentication, or service",
    );
  });

  it.each(["utility", "authentication", "service"])("preserves a valid category %s", (category) => {
    const result = parseOutboundMessage({ ...VALID_BODY, category });
    expect(result.category).toBe(category);
  });

  it("leaves the category undefined when it is absent", () => {
    const result = parseOutboundMessage(VALID_BODY);
    expect(result.category).toBeUndefined();
  });

  it("throws ValidationError on a non-object body", () => {
    for (const body of [null, "string", 42, ["array"]]) {
      expect(() => parseOutboundMessage(body)).toThrow(ValidationError);
      expect(() => parseOutboundMessage(body)).toThrow("Invalid request body");
    }
  });
});
