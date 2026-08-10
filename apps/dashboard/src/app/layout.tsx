import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nexus — WABA Dashboard",
  description:
    "WhatsApp Business API gateway — manage devices, keys, webhooks, and message delivery from one place.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
    >
      {/* suppressHydrationWarning: browser extensions inject stray attrs
          (e.g. inmaintabuse) into <body> before React hydrates */}
      <body
        className="min-h-full bg-canvas text-fg font-sans antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
