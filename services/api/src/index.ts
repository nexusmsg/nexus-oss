import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/", (c) => c.json({ ok: true, service: "api" }));

export default app;

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
}
