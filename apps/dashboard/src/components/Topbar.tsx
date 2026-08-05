import { IconSearch, IconBell, IconMenu } from "./icons";

interface TopbarProps {
  onMenuToggle: () => void;
  placeholder?: string;
}

export function Topbar({ onMenuToggle, placeholder }: TopbarProps) {
  return (
    <header className="topbar">
      <button
        className="topbar-btn mobile-menu-btn"
        onClick={onMenuToggle}
        aria-label="Toggle menu"
      >
        <IconMenu />
      </button>
      <div className="search-box">
        <IconSearch />
        <input type="text" placeholder={placeholder || "Search..."} />
        <kbd>⌘K</kbd>
      </div>
      <div className="topbar-actions">
        <button className="topbar-btn" aria-label="Notifications">
          <IconBell />
          <span className="dot" />
        </button>
        <div className="topbar-divider" />
        <div
          className="avatar"
          style={{ width: 28, height: 28, fontSize: 11, cursor: "pointer" }}
        >
          AZ
        </div>
      </div>
    </header>
  );
}
