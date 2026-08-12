import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApiKeysPage from "./page";
import type { ApiKey } from "@/lib/api/types";
import type { UseApiKeysReturn } from "@/lib/hooks/useApiKeys";

vi.mock("@/lib/hooks/useApiKeys", () => ({
  useApiKeys: vi.fn(),
}));

import { useApiKeys } from "@/lib/hooks/useApiKeys";

const mockedUseApiKeys = vi.mocked(useApiKeys);

const DAY_MS = 24 * 60 * 60 * 1000;

function makeKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    serial: "key_1",
    name: "Production",
    key_prefix: "waba_prod_",
    scope: "full",
    status: "active",
    expires_at: null,
    last_used_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function mockUseApiKeys(
  keys: ApiKey[],
  overrides: Partial<UseApiKeysReturn> = {},
) {
  mockedUseApiKeys.mockReturnValue({
    keys,
    loading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
    update: vi.fn(),
    revoke: vi.fn(),
    ...overrides,
  } as UseApiKeysReturn);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ApiKeysPage (UI-2 static composition)", () => {
  it("renders the page header, Generate Key CTA, and the seven table columns", () => {
    mockUseApiKeys([makeKey()]);
    render(<ApiKeysPage />);

    expect(screen.getByRole("heading", { name: "API Keys" })).toBeTruthy();
    expect(
      screen.getByText("Manage authentication keys for your integrations"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate Key/ })).toBeTruthy();

    for (const col of ["Name", "Key", "Scope", "Created", "Last Used", "Status", "Actions"]) {
      expect(screen.getByRole("columnheader", { name: col })).toBeTruthy();
    }
  });

  it("renders key rows with masked prefix, scope, dates, status, and action buttons", () => {
    const now = Date.now();
    mockUseApiKeys([
      makeKey(),
      makeKey({
        serial: "key_2",
        name: "Staging",
        key_prefix: "waba_test_",
        scope: "read",
        expires_at: new Date(now + 5 * DAY_MS).toISOString(),
        last_used_at: new Date(now - 2 * 60 * 1000).toISOString(),
      }),
    ]);
    render(<ApiKeysPage />);

    const prodRow = screen.getByRole("row", { name: /Production/ });
    expect(within(prodRow).getByText(/^waba_prod_/)).toBeTruthy();
    expect(within(prodRow).getByText("full")).toBeTruthy();
    expect(within(prodRow).getByText("2026-08-10")).toBeTruthy();
    expect(within(prodRow).getByText("never")).toBeTruthy();
    expect(within(prodRow).getByText("active")).toBeTruthy();
    // Reveal / Copy / Rename / Revoke — all present but non-functional.
    expect(within(prodRow).getAllByRole("button")).toHaveLength(4);

    const stagingRow = screen.getByRole("row", { name: /Staging/ });
    expect(within(stagingRow).getByText("2 min ago")).toBeTruthy();
    expect(within(stagingRow).getByText("expiring")).toBeTruthy();
  });

  it("filters rows by status using local state", async () => {
    const now = Date.now();
    mockUseApiKeys([
      makeKey({ serial: "key_1", name: "Production" }),
      makeKey({
        serial: "key_2",
        name: "Staging",
        expires_at: new Date(now + 5 * DAY_MS).toISOString(),
      }),
      makeKey({ serial: "key_3", name: "CI/CD Pipeline", status: "revoked" }),
    ]);
    render(<ApiKeysPage />);

    const select = screen.getByRole("combobox", { name: "Filter by status" });
    expect(screen.getByRole("row", { name: /Production/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /Staging/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /CI\/CD/ })).toBeTruthy();

    await userEvent.selectOptions(select, "active");
    expect(screen.getByRole("row", { name: /Production/ })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /Staging/ })).toBeNull();
    expect(screen.queryByRole("row", { name: /CI\/CD/ })).toBeNull();

    await userEvent.selectOptions(select, "expiring");
    expect(screen.getByRole("row", { name: /Staging/ })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /Production/ })).toBeNull();
    expect(screen.queryByRole("row", { name: /CI\/CD/ })).toBeNull();

    await userEvent.selectOptions(select, "revoked");
    expect(screen.getByRole("row", { name: /CI\/CD/ })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /Production/ })).toBeNull();
    expect(screen.queryByRole("row", { name: /Staging/ })).toBeNull();

    await userEvent.selectOptions(select, "all");
    expect(screen.getByRole("row", { name: /Production/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /Staging/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /CI\/CD/ })).toBeTruthy();
  });

  it("shows a 'no keys match' row when the active filter matches nothing", async () => {
    mockUseApiKeys([makeKey({ status: "revoked", name: "CI/CD Pipeline" })]);
    render(<ApiKeysPage />);

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Filter by status" }),
      "active",
    );
    expect(screen.getByText("No keys match this filter.")).toBeTruthy();
  });

  it("shows the expiring-soon warning for keys expiring within the window", () => {
    const now = Date.now();
    mockUseApiKeys([
      makeKey(),
      makeKey({
        serial: "key_2",
        name: "Staging",
        expires_at: new Date(now + 5 * DAY_MS).toISOString(),
      }),
    ]);
    render(<ApiKeysPage />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("1 key expiring soon.");
    expect(alert.textContent).toContain('"Staging"');
    expect(alert.textContent).toContain("expires in 5 days");
  });

  it("omits the warning when no keys are expiring soon", () => {
    mockUseApiKeys([
      makeKey(),
      makeKey({
        serial: "key_2",
        name: "Staging",
        expires_at: new Date(Date.now() + 90 * DAY_MS).toISOString(),
      }),
    ]);
    render(<ApiKeysPage />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the loading skeleton while the list is loading", () => {
    mockUseApiKeys([], { loading: true });
    render(<ApiKeysPage />);
    // Header row + 3 skeleton rows.
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getByRole("heading", { name: "API Keys" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate Key/ })).toBeTruthy();
  });

  it("renders the empty state when there are no keys", () => {
    mockUseApiKeys([]);
    render(<ApiKeysPage />);
    expect(screen.getByText("No API keys yet")).toBeTruthy();
  });

  it("renders the error banner and retries through refresh", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    mockUseApiKeys([], { error: "Failed to load API keys", refresh });
    render(<ApiKeysPage />);

    expect(screen.getByText("Failed to load API keys")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("ApiKeysPage (UI-3 secure visibility)", () => {
  it("marks Reveal/Copy as unavailable with a secure explanation and keeps Rename/Revoke placeholders", () => {
    mockUseApiKeys([makeKey({ name: "Production" })]);
    render(<ApiKeysPage />);

    const row = screen.getByRole("row", { name: /Production/ });
    const reveal = within(row).getByRole("button", {
      name: "Reveal Production",
    });
    const copy = within(row).getByRole("button", {
      name: "Copy Production",
    });
    const rename = within(row).getByRole("button", {
      name: "Rename Production",
    });
    const revoke = within(row).getByRole("button", {
      name: "Revoke Production",
    });

    // Every existing-key action stays a disabled affordance.
    for (const btn of [reveal, copy, rename, revoke]) {
      expect(btn.getAttribute("aria-disabled")).toBe("true");
    }

    // Reveal/Copy explain why there is nothing to show or copy.
    expect(reveal.getAttribute("title")).toContain("Nothing to reveal");
    expect(reveal.getAttribute("title")).toContain("secret isn't stored");
    expect(copy.getAttribute("title")).toContain("Nothing to copy");
    expect(copy.getAttribute("title")).toContain("secret isn't stored");

    // The explanatory tooltips are present in the DOM (CSS-only, always mounted).
    expect(screen.getAllByRole("tooltip").length).toBeGreaterThanOrEqual(4);
    expect(
      screen.getByRole("tooltip", { name: /Nothing to reveal/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tooltip", { name: /Nothing to copy/ }),
    ).toBeTruthy();

    // Rename/Revoke keep their plain placeholder labels for later phases.
    expect(rename.getAttribute("title")).toBe("Rename");
    expect(revoke.getAttribute("title")).toBe("Revoke");
  });

  it("never reveals a plaintext secret or copies it to the clipboard for existing keys", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    mockUseApiKeys([makeKey({ name: "Production", key_prefix: "waba_prod_" })]);
    render(<ApiKeysPage />);

    const row = screen.getByRole("row", { name: /Production/ });
    const maskedCell = within(row).getByText(/^waba_prod_/);
    const maskedText = maskedCell.textContent;

    // Clicking Copy never touches the clipboard.
    await userEvent.click(
      within(row).getByRole("button", { name: "Copy Production" }),
    );
    expect(writeText).not.toHaveBeenCalled();

    // Clicking Reveal never surfaces a plaintext secret — the cell stays masked.
    await userEvent.click(
      within(row).getByRole("button", { name: "Reveal Production" }),
    );
    expect(within(row).getByText(/^waba_prod_/).textContent).toBe(maskedText);
  });
});
