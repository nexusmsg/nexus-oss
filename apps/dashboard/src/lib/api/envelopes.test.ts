import { describe, expect, it } from "vitest";
import { errorEnvelope, internalError, unauthorized } from "./envelopes";

describe("errorEnvelope", () => {
  it("builds the WABA error envelope and maps details to error_data.details", async () => {
    const res = errorEnvelope("Bad request", 400, "detail here");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        message: "Bad request",
        type: "OAuthException",
        code: 400,
        error_data: { details: "detail here" },
      },
    });
  });

  it("omits error_data when no details are given", async () => {
    const res = errorEnvelope("Bad request", 400);

    expect(await res.json()).toEqual({
      error: { message: "Bad request", type: "OAuthException", code: 400 },
    });
  });
});

describe("envelope helpers", () => {
  it("returns the byte-identical 401 envelope for an invalid token", async () => {
    const res = unauthorized();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { message: "Invalid OAuth access token", type: "OAuthException", code: 401 },
    });
  });

  it("returns the byte-identical 500 envelope for a thrown handler", async () => {
    const res = internalError();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { message: "Internal server error", type: "OAuthException", code: 500 },
    });
  });
});