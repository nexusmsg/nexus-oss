/**
 * Vitest setup for the dashboard. The jsdom environment is configured in
 * vitest.config.ts; this file wires Testing Library cleanup so rendered
 * hooks/components don't leak state between tests.
 */
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
