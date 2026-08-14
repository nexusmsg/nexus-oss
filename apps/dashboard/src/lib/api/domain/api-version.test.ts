/**
 * Unit tests for the WABA API version validation module.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_VERSION,
  parseApiVersion,
  SUPPORTED_API_VERSIONS,
} from "./api-version";

describe("parseApiVersion", () => {
  it("accepts the default supported version", () => {
    expect(parseApiVersion("v26.0")).toBe("v26.0");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(parseApiVersion(" V26.0 ")).toBe("v26.0");
  });

  it.each([
    ["v27.0"],
    ["v26"],
    ["26.0"],
    ["v26.0.1"],
    ["v26.1"],
    [""],
    ["abc"],
    ["v"],
  ])("rejects %j", (raw) => {
    expect(parseApiVersion(raw)).toBeNull();
  });

  it("exposes the default as the current supported version", () => {
    expect(DEFAULT_API_VERSION).toBe("v26.0");
    expect(SUPPORTED_API_VERSIONS).toEqual(["v26.0"]);
  });
});
