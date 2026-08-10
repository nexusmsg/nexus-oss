import { cx } from "./cx";
import { StatusDot } from "./Badge";
import type { HTMLAttributes } from "react";

type DeviceState = "connected" | "disconnected" | "pairing" | "error";

interface Device {
  phone: string;
  label: string;
  state: DeviceState;
}

interface DeviceStatusProps extends HTMLAttributes<HTMLDivElement> {
  devices: Device[];
}

const badgeClasses: Record<DeviceState, string> = {
  connected: "bg-success/12 text-success",
  disconnected: "bg-danger/12 text-danger",
  pairing: "bg-warning/12 text-warning",
  error: "bg-danger/12 text-danger",
};

const stateLabels: Record<DeviceState, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  pairing: "Pairing",
  error: "Error",
};

export function DeviceStatus({ devices, className, ...props }: DeviceStatusProps) {
  return (
    <div className={cx("flex flex-wrap gap-4", className)} {...props}>
      {devices.map((device) => (
        <div
          key={device.phone}
          className="flex min-w-[200px] flex-1 items-center gap-3 rounded-lg border border-line bg-surface px-5 py-4"
        >
          <StatusDot state={device.state} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-sm font-medium">{device.phone}</span>
            <span className="text-2xs text-muted">{device.label}</span>
          </div>
          <span
            className={cx(
              "shrink-0 rounded-pill px-2 py-0.5 font-mono text-2xs font-semibold",
              badgeClasses[device.state],
            )}
          >
            {stateLabels[device.state]}
          </span>
        </div>
      ))}
    </div>
  );
}
