import { describe, expect, it } from "vitest";
import { redactHeaders } from "./observability-capture/redact";

describe("redactHeaders", () => {
  it("redacts secret headers and passes benign headers through", () => {
    const headers = new Headers({ "content-type": "application/json" });
    headers.set("authorization", "Bearer tok");
    headers.set("cookie", "a=b");

    expect(redactHeaders(headers)).toEqual({
      authorization: "<redacted>",
      cookie: "<redacted>",
      "content-type": "application/json",
    });
  });

  it("redacts x-api-key and x-forwarded-authorization case-insensitively", () => {
    const headers = new Headers({
      "X-API-KEY": "secret",
      "X-FORWARDED-AUTHORIZATION": "tok",
    });

    // Headers normalizes keys to lowercase when iterating.
    expect(redactHeaders(headers)).toEqual({
      "x-api-key": "<redacted>",
      "x-forwarded-authorization": "<redacted>",
    });
  });

  it("returns an empty record for empty headers", () => {
    expect(redactHeaders(new Headers())).toEqual({});
  });
});