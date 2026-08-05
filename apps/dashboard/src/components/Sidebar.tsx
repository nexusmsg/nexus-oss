import { NavLink } from "react-router-dom";
import {
  IconNexus,
  IconDashboard,
  IconKey,
  IconPhone,
  IconWebhook,
  IconJobs,
  IconSettings,
} from "./icons";
import type { ReactNode } from "react";

interface NavItemProps {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number;
  disabled?: boolean;
}

function NavItem({ to, icon, label, badge, disabled }: NavItemProps) {
  if (disabled) {
    return (
      <div className="nav-item" style={{ opacity: 0.4, cursor: "default" }}>
        {icon}
        {label}
        <span
          className="tooltip-wrapper"
          style={{ marginLeft: "auto" }}
        >
          <span className="tooltip-text">Coming soon</span>
          <span
            style={{
              fontSize: "10px",
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            soon
          </span>
        </span>
      </div>
    );
  }

  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `nav-item${isActive ? " active" : ""}`
      }
    >
      {icon}
      {label}
      {badge !== undefined && (
        <span className="badge">{badge}</span>
      )}
    </NavLink>
  );
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 99,
          }}
        />
      )}
      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="sidebar-header">
          <span style={{ color: "var(--accent)" }}><IconNexus /></span>
          <span>Nexus</span>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">Overview</div>
          <NavItem
            to="/dashboard-placeholder"
            icon={<IconDashboard />}
            label="Dashboard"
            disabled
          />

          <div className="nav-section">Manage</div>
          <NavItem to="/api-keys" icon={<IconKey />} label="API Keys" />
          <NavItem to="/sessions" icon={<IconPhone />} label="Sessions" />
          <NavItem to="/webhooks" icon={<IconWebhook />} label="Webhooks" />

          <div className="nav-section">Monitor</div>
          <NavItem
            to="/jobs-placeholder"
            icon={<IconJobs />}
            label="Jobs"
            disabled
          />
          <NavItem
            to="/settings-placeholder"
            icon={<IconSettings />}
            label="Settings"
            disabled
          />
        </nav>
        <div className="sidebar-footer">
          <div className="avatar">AZ</div>
          <div className="user-info">
            <div className="user-name">Aziz M.</div>
            <div className="user-role">Admin</div>
          </div>
        </div>
      </aside>
    </>
  );
}
