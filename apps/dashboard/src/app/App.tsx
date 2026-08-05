import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./auth-context";
import { Shell } from "./Shell";
import { AuthGate } from "../components/AuthGate";
import { SessionsPage } from "../routes/sessions/SessionsPage";
import { WebhooksPage } from "../routes/webhooks/WebhooksPage";
import { ApiKeysPage } from "../routes/api-keys/ApiKeysPage";

export function App() {
  const { showGate } = useAuth();

  if (showGate) {
    return <AuthGate />;
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/sessions" replace />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/webhooks" element={<WebhooksPage />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Route>
    </Routes>
  );
}
