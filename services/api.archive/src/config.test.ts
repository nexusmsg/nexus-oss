import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig — CORS_ORIGINS", () => {
  it("defaults to the dev dashboard origins when unset", () => {
    const cfg = loadConfig({});
    expect(cfg.corsOrigins).toEqual([
      "http://localhost:5173",
      "http://localhost:3002",
    ]);
  });

  it("parses a comma-separated list, trimming whitespace and dropping empties", () => {
    const cfg = loadConfig({
      CORS_ORIGINS: " http://a.example ,http://b.example, , http://c.example",
    });
    expect(cfg.corsOrigins).toEqual([
      "http://a.example",
      "http://b.example",
      "http://c.example",
    ]);
  });

  it("disables CORS when the value is an empty string", () => {
    const cfg = loadConfig({ CORS_ORIGINS: "" });
    expect(cfg.corsOrigins).toEqual([]);
  });
});
