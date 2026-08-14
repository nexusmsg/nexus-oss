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

/** Shape of the mocked hook return, including the `reveal` function
 *  that the backend lane adds in parallel. */
type MockHookReturn = UseApiKeysReturn & {
  reveal: (serial: string) => Promise<string>;
};

function mockUseApiKeys(
  keys: ApiKey[],
  overrides: Partial<MockHookReturn> = {},
) {
  mockedUseApiKeys.mockReturnValue({
    keys,
    loading: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
    update: vi.fn(),
    revoke: vi.fn(),
    reveal: vi.fn(),
    ...overrides,
  } as MockHookReturn);
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
    // Reveal / Copy / Rename / Revoke — all four present.
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

describe("ApiKeysPage (UI-6 reveal/copy row actions)", () => {
  it("enables Reveal and Copy for active keys", () => {
    mockUseApiKeys([makeKey({ name: "Production", status: "active" })]);
    render(<ApiKeysPage />);

    const row = screen.getByRole("row", { name: /Production/ });
    const reveal = within(row).getByRole("button", {
      name: "Reveal Production",
    });
    const copy = within(row).getByRole("button", {
      name: "Copy Production",
    });

    // Active keys: neither button is disabled.
    expect(reveal.getAttribute("aria-disabled")).toBeNull();
    expect(copy.getAttribute("aria-disabled")).toBeNull();
  });

  it("disables Reveal and Copy for revoked keys with explanatory tooltips", () => {
    mockUseApiKeys([
      makeKey({ name: "Old Key", status: "revoked" }),
    ]);
    render(<ApiKeysPage />);

    const row = screen.getByRole("row", { name: /Old Key/ });
    const reveal = within(row).getByRole("button", {
      name: "Reveal Old Key",
    });
    const copy = within(row).getByRole("button", {
      name: "Copy Old Key",
    });
    const rename = within(row).getByRole("button", {
      name: "Rename Old Key",
    });
    const revoke = within(row).getByRole("button", {
      name: "Revoke Old Key",
    });

    // Reveal/Copy disabled for revoked keys.
    expect(reveal.getAttribute("aria-disabled")).toBe("true");
    expect(copy.getAttribute("aria-disabled")).toBe("true");

    // Reveal/Copy explain why.
    expect(reveal.getAttribute("title")).toContain("revoked");
    expect(copy.getAttribute("title")).toContain("revoked");

    // Rename/Revoke remain functional.
    expect(rename.getAttribute("aria-disabled")).toBeNull();
    expect(revoke.getAttribute("aria-disabled")).toBeNull();
  });

  it("opens the reveal modal in 'reveal' mode after a successful fetch", async () => {
    const reveal = vi.fn().mockResolvedValue("waba_prod_SECRETVALUE123");
    mockUseApiKeys(
      [makeKey({ name: "Production", key_prefix: "waba_prod_" })],
      { reveal },
    );
    render(<ApiKeysPage />);

    const row = screen.getByRole("row", { name: /Production/ });
    await userEvent.click(
      within(row).getByRole("button", { name: "Reveal Production" }),
    );

    // Hook reveal was called with the serial.
    expect(reveal).toHaveBeenCalledWith("key_1");

    // Modal opens with "Reveal Key" title and the fetched secret.
    expect(screen.getByRole("dialog", { name: "Reveal Key" })).toBeTruthy();
    expect(screen.getByText("waba_prod_SECRETVALUE123")).toBeTruthy();
    expect(
      screen.getByText("Copy this key and store it securely."),
    ).toBeTruthy();
  });

  it("shows an error message when the reveal fetch fails", async () => {
    const reveal = vi
      .fn()
      .mockRejectedValue(new Error("API key is revoked"));
    mockUseApiKeys(
      [makeKey({ name: "Production", status: "active" })],
      { reveal },
    );
    render(<ApiKeysPage />);

    const row = screen.getByRole("row", { name: /Production/ });
    await userEvent.click(
      within(row).getByRole("button", { name: "Reveal Production" }),
    );

    // Modal should NOT open.
    expect(screen.queryByRole("dialog")).toBeNull();

    // Error message appears below the row actions.
    const alerts = screen.getAllByRole("alert");
    const error = alerts.find((el) =>
      el.textContent?.includes("API key is revoked"),
    );
    expect(error).toBeTruthy();
  });

  it("copies the key to clipboard via the Copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const reveal = vi.fn().mockResolvedValue("waba_prod_SECRETVALUE123");
    mockUseApiKeys(
      [makeKey({ name: "Production", key_prefix: "waba_prod_" })],
      { reveal },
    );
    render(<ApiKeysPage />);

    const row = screen.getByRole("row", { name: /Production/ });
    await userEvent.click(
      within(row).getByRole("button", { name: "Copy Production" }),
    );

    expect(reveal).toHaveBeenCalledWith("key_1");
    expect(writeText).toHaveBeenCalledWith("waba_prod_SECRETVALUE123");

    // Success feedback tooltip appears on the copy button.
    const copyBtn = within(row).getByRole("button", {
      name: "Copy Production",
    });
    expect(copyBtn.getAttribute("title")).toContain("Copied");
  });

  it("shows an error when the Copy fetch fails", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const reveal = vi
      .fn()
      .mockRejectedValue(new Error("Key not found"));
    mockUseApiKeys(
      [makeKey({ name: "Production", status: "active" })],
      { reveal },
    );
    render(<ApiKeysPage />);

    const row = screen.getByRole("row", { name: /Production/ });
    await userEvent.click(
      within(row).getByRole("button", { name: "Copy Production" }),
    );

    expect(writeText).not.toHaveBeenCalled();

    // Copy button gets error feedback tooltip.
    const copyBtn = within(row).getByRole("button", {
      name: "Copy Production",
    });
    expect(copyBtn.getAttribute("title")).toContain("Failed to copy");
  });

  it("clears the plaintext secret from the DOM after the reveal modal closes", async () => {
    const reveal = vi.fn().mockResolvedValue("waba_prod_TOPSECRET");
    mockUseApiKeys(
      [makeKey({ name: "Production", key_prefix: "waba_prod_" })],
      { reveal },
    );
    render(<ApiKeysPage />);

    const row = screen.getByRole("row", { name: /Production/ });
    await userEvent.click(
      within(row).getByRole("button", { name: "Reveal Production" }),
    );

    // Secret is visible in the modal.
    expect(screen.getByText("waba_prod_TOPSECRET")).toBeTruthy();

    // Close the modal.
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    // Secret is no longer in the DOM.
    expect(screen.queryByText("waba_prod_TOPSECRET")).toBeNull();
    // Modal is closed.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
