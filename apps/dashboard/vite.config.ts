import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // No proxy — the app calls the API cross-origin via VITE_API_URL.
  // CORS is handled by the backend.
});
