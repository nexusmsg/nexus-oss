import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth-context";

// Test component that reads auth state
function AuthStateReader() {
  const { authorization, showGate, clearAuth } = useAuth();
  return (
    <div>
      <span data-testid="authorization">{authorization || "null"}</span>
      <span data-testid="showGate">{showGate.toString()}</span>
      <button onClick={clearAuth}>Clear</button>
    </div>
  );
}

function renderWithAuth() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AuthStateReader />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("shows gate when no env token and no cached auth", () => {
    vi.stubEnv("VITE_API_TOKEN", "");
    renderWithAuth();
    expect(screen.getByTestId("showGate")).toHaveTextContent("true");
    expect(screen.getByTestId("authorization")).toHaveTextContent("null");
  });

  it("uses env token as Bearer when set", () => {
    vi.stubEnv("VITE_API_TOKEN", "my-secret-token");
    renderWithAuth();
    expect(screen.getByTestId("showGate")).toHaveTextContent("false");
    expect(screen.getByTestId("authorization")).toHaveTextContent(
      "Bearer my-secret-token",
    );
  });

  it("uses cached basic auth from sessionStorage", () => {
    vi.stubEnv("VITE_API_TOKEN", "");
    const encoded = btoa("nexus:pass123");
    sessionStorage.setItem("nexus_basic_auth", encoded);
    renderWithAuth();
    expect(screen.getByTestId("showGate")).toHaveTextContent("false");
    expect(screen.getByTestId("authorization")).toHaveTextContent(
      `Basic ${encoded}`,
    );
  });

  it("clearAuth resets to gate state", () => {
    vi.stubEnv("VITE_API_TOKEN", "");
    renderWithAuth();
    expect(screen.getByTestId("showGate")).toHaveTextContent("true");

    // Clicking clear should keep gate visible
    screen.getByText("Clear").click();
    expect(screen.getByTestId("showGate")).toHaveTextContent("true");
    expect(screen.getByTestId("authorization")).toHaveTextContent("null");
  });
});
