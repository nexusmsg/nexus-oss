import { describe, expect, it } from "vitest";
import app from "./index.js";

describe("GET /", () => {
  it("returns ok and service name", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "api" });
  });
});
