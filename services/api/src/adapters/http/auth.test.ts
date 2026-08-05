import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { authorizeBearer, safeEqual, WWW_AUTHENTICATE_BASIC } from "./auth.js";

/**
 * Minimal fake Hono context: `authorizeBearer` only reads the Authorization
 * header, so a partial object is sufficient for these unit tests.
 */
function ctxWithAuth(header: string | undefined): Context {
  return {
    req: { header: (name: string) => (name === "Authorization" ? header : undefined) },
  } as unknown as Context;
}

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

describe("safeEqual", () => {
  it("compares equal strings as true", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
  });

  it("compares unequal strings as false", () => {
    expect(safeEqual("secret", "other")).toBe(false);
  });

  it("never compares unequal lengths as equal", () => {
    expect(safeEqual("a", "bb")).toBe(false);
  });

  it("compares equal-length but different content as false", () => {
    expect(safeEqual("aaaa", "aaab")).toBe(false);
  });
});

describe("authorizeBearer — Bearer scheme", () => {
  it("accepts the correct token", () => {
    expect(authorizeBearer(ctxWithAuth("Bearer topsecret"), "topsecret")).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(authorizeBearer(ctxWithAuth("Bearer nope"), "topsecret")).toBe(false);
  });
});

describe("authorizeBearer — Basic scheme", () => {
  it("accepts when the password equals the expected token", () => {
    expect(authorizeBearer(ctxWithAuth(basic("nexus", "topsecret")), "topsecret")).toBe(true);
  });

  it("accepts any free-form username", () => {
    expect(authorizeBearer(ctxWithAuth(basic("someone-else", "topsecret")), "topsecret")).toBe(true);
  });

  it("rejects a wrong password", () => {
    expect(authorizeBearer(ctxWithAuth(basic("nexus", "wrong")), "topsecret")).toBe(false);
  });

  it("rejects a malformed header that is not base64", () => {
    expect(authorizeBearer(ctxWithAuth("Basic not-base64!!"), "topsecret")).toBe(false);
  });

  it("rejects a base64 value with no colon", () => {
    // base64 of "justausername" (no colon)
    expect(authorizeBearer(ctxWithAuth("Basic anVzdGF1c2VybmFtZQ=="), "topsecret")).toBe(false);
  });

  it("rejects a Basic header with an empty password", () => {
    expect(authorizeBearer(ctxWithAuth(basic("nexus", "")), "topsecret")).toBe(false);
  });
});

describe("authorizeBearer — Bearer takes precedence", () => {
  it("treats a Bearer header as Bearer, never parsing it as Basic", () => {
    // The Bearer value is exactly the expected token (so it passes via Bearer),
    // and it is also valid base64 containing a colon (so a Basic parse would
    // find a colon). Bearer must win and still pass.
    const header = `Bearer ${Buffer.from("user:pass").toString("base64")}`;
    expect(authorizeBearer(ctxWithAuth(header), Buffer.from("user:pass").toString("base64"))).toBe(
      true,
    );
  });

  it("does not fall through to Basic when a Bearer token is wrong", () => {
    // A Bearer-formatted header whose value, if base64-decoded, would contain
    // the correct password as `user:pass`. Because it starts with "Bearer ",
    // it must be compared as a raw token and rejected — not decoded as Basic.
    const base64 = Buffer.from("nexus:topsecret").toString("base64");
    expect(authorizeBearer(ctxWithAuth(`Bearer ${base64}`), "topsecret")).toBe(false);
  });
});

describe("authorizeBearer — misc", () => {
  it("returns true for any request when auth is disabled (empty token)", () => {
    expect(authorizeBearer(ctxWithAuth(undefined), "")).toBe(true);
    expect(authorizeBearer(ctxWithAuth("Basic garbage!!"), "")).toBe(true);
  });

  it("returns false when no Authorization header is present", () => {
    expect(authorizeBearer(ctxWithAuth(undefined), "topsecret")).toBe(false);
  });

  it("returns false for an unsupported scheme", () => {
    expect(authorizeBearer(ctxWithAuth("Digest topsecret"), "topsecret")).toBe(false);
  });
});

describe("WWW_AUTHENTICATE_BASIC", () => {
  it("is the Basic realm header value", () => {
    expect(WWW_AUTHENTICATE_BASIC).toBe('Basic realm="nexus"');
  });
});
