import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { Topbar } from "../components/Topbar";

export function Shell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main">
        <Topbar onMenuToggle={() => setSidebarOpen((o) => !o)} />
        <div className="content">
          <Outlet />
        </div>
      </div>

      <style>{`
        .mobile-menu-btn {
          display: none;
        }
        @media (max-width: 768px) {
          .mobile-menu-btn {
            display: flex;
          }
        }
      `}</style>
    </>
  );
}
