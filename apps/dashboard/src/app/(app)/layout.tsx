"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, Topbar } from "@/components";
import {
  IconDashboard,
  IconKey,
  IconPhone,
  IconWebhook,
  IconJobs,
  IconSettings,
} from "@/components/icons";

const sidebarGroups = [
  {
    title: "Overview",
    items: [{ icon: <IconDashboard />, label: "Dashboard", href: "/" }],
  },
  {
    title: "Manage",
    items: [
      { icon: <IconKey />, label: "API Keys", href: "/api-keys" },
      { icon: <IconPhone />, label: "Sessions", href: "/sessions" },
      { icon: <IconWebhook />, label: "Webhooks", href: "/webhooks" },
    ],
  },
  {
    title: "Monitor",
    items: [
      { icon: <IconJobs />, label: "Jobs", href: "/jobs" },
      { icon: <IconSettings />, label: "Settings", href: "/settings" },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // Derive active state from pathname
  const groups = sidebarGroups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      active:
        item.href === "/"
          ? pathname === "/"
          : pathname.startsWith(item.href),
    })),
  }));

  return (
    <div className="flex bg-canvas text-fg">
      <Sidebar
        groups={groups}
        user={{ name: "Aziz M.", role: "Admin", initials: "AZ" }}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex flex-1 flex-col min-w-0 md:ml-[var(--sidebar-w)]">
        <Topbar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />

        <main className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {children}
        </main>
      </div>
    </div>
  );
}
