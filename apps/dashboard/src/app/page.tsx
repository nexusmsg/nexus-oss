"use client";

import { useState } from "react";
import {
  Button,
  Badge,
  StatusDot,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  TableWrap,
  Table,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableCell,
  Mono,
  FormGroup,
  FormLabel,
  FormInput,
  FormSelect,
  FormHint,
  Alert,
  EmptyState,
  Modal,
  ModalActions,
  Tooltip,
  Sidebar,
  Topbar,
  StatCard,
  DeviceStatus,
  Toggle,
  APIKeyRow,
  QuickActions,
  PasswordStrength,
  Avatar,
  ExpandableRow,
} from "@/components";
import {
  IconDashboard,
  IconKey,
  IconPhone,
  IconWebhook,
  IconJobs,
  IconSettings,
  IconPlus,
  IconInfo,
  IconWarning,
  IconEye,
  IconCopy,
  IconPlay,
} from "@/components/icons";

/* ── Sidebar nav config ── */
const sidebarItems = [
  { icon: <IconDashboard />, label: "Dashboard", href: "#" },
  { icon: <IconKey />, label: "API Keys", href: "#", count: 3 },
  { icon: <IconPhone />, label: "Sessions", href: "#" },
  { icon: <IconWebhook />, label: "Webhooks", href: "#" },
  { icon: <IconJobs />, label: "Jobs", href: "#" },
  { icon: <IconSettings />, label: "Settings", href: "#" },
];

/* ── Page ───────────────────────────────────────────────── */

export default function PlaygroundPage() {
  // App shell state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Interactive component state
  const [modalOpen, setModalOpen] = useState(false);
  const [toggle1, setToggle1] = useState(true);
  const [toggle2, setToggle2] = useState(false);
  const [toggleDisabled, setToggleDisabled] = useState(true);
  const [password, setPassword] = useState("");
  const [passwordStrength, setPasswordStrength] = useState<0 | 1 | 2 | 3>(0);
  const [apiRevealed, setApiRevealed] = useState(false);
  const [apiCopied, setApiCopied] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    method: "POST",
    webhookUrl: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, boolean>>({});

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    const len = value.length;
    if (len === 0) setPasswordStrength(0);
    else if (len < 6) setPasswordStrength(1);
    else if (len < 10) setPasswordStrength(2);
    else setPasswordStrength(3);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, boolean> = {};
    if (!formData.name) errors.name = true;
    if (!formData.email) errors.email = true;
    setFormErrors(errors);
  };

  const handleCopyKey = () => {
    setApiCopied(true);
    setTimeout(() => setApiCopied(false), 1500);
  };

  return (
    <div className="flex bg-canvas text-fg">
      {/* ── Sidebar ── */}
      <Sidebar
        items={sidebarItems}
        user={{ name: "Aziz M.", role: "Admin", initials: "AZ" }}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* ── Main area ── */}
      <div className="flex flex-1 flex-col md:ml-[var(--sidebar-w)]">
        {/* ── Topbar ── */}
        <Topbar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />

        {/* ── Scrollable content ── */}
        <main className="flex-1 overflow-y-auto p-6 md:p-6 flex flex-col gap-6">
          {/* Page Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Design System Playground
              </h1>
              <p className="mt-1 text-sm text-muted">
                Verification surface — every component and state rendered with
                real Nexus copy
              </p>
            </div>
            <Badge variant="success" dot>
              All systems operational
            </Badge>
          </div>

          {/* ════════════════════════════════════════════════════════
              Section 1: Buttons
              ════════════════════════════════════════════════════════ */}
          <Card>
            <CardHeader>
              <CardTitle>Buttons</CardTitle>
              <span className="text-sm text-muted">Variants & States</span>
            </CardHeader>
            <CardBody>
              <div className="flex flex-col gap-5">
                {/* Variants */}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    Variants
                  </h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="primary">Primary</Button>
                    <Button variant="ghost">Ghost</Button>
                    <Button variant="danger">Danger</Button>
                    <Tooltip content="Icon button">
                      <Button variant="icon" aria-label="Info">
                        <IconInfo size={14} />
                      </Button>
                    </Tooltip>
                  </div>
                </div>

                {/* Sizes */}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    Sizes
                  </h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm">Small</Button>
                    <Button>Default</Button>
                  </div>
                </div>

                {/* States */}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    States
                  </h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button>Normal</Button>
                    <Button disabled>Disabled</Button>
                    <Button loading>Loading</Button>
                    <Button variant="ghost" disabled>
                      Ghost Disabled
                    </Button>
                    <Button variant="danger" disabled>
                      Danger Disabled
                    </Button>
                  </div>
                </div>

                {/* Active/Pressed */}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    Active / Pressed (hold to verify)
                  </h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button className="active:scale-95 active:opacity-80">
                      Press Me
                    </Button>
                    <Button
                      variant="ghost"
                      className="active:scale-95 active:opacity-80"
                    >
                      Ghost Press
                    </Button>
                    <Button
                      variant="danger"
                      className="active:scale-95 active:opacity-80"
                    >
                      Danger Press
                    </Button>
                  </div>
                </div>

                {/* With Icons */}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    With Icons
                  </h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button>
                      <IconPlus size={14} /> Generate Key
                    </Button>
                    <Button variant="ghost">
                      <IconPlay size={14} /> Test Endpoint
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-muted italic">
                  Hover and focus states are interaction-only — verify by
                  tabbing through and hovering each button above.
                </p>
              </div>
            </CardBody>
          </Card>

          {/* ════════════════════════════════════════════════════════
              Section 2: Badges & StatusDots
              ════════════════════════════════════════════════════════ */}
          <Card>
            <CardHeader>
              <CardTitle>Badges & StatusDots</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="flex flex-col gap-5">
                {/* Badge Variants */}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    Badge Variants
                  </h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="success">delivered</Badge>
                    <Badge variant="danger">503</Badge>
                    <Badge variant="warning">rotated</Badge>
                    <Badge variant="info">inbound</Badge>
                    <Badge variant="neutral">neutral</Badge>
                  </div>
                </div>

                {/* Badge with Dots */}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    Badge with Dots
                  </h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="success" dot>
                      delivered
                    </Badge>
                    <Badge variant="danger" dot>
                      failed
                    </Badge>
                    <Badge variant="warning" dot>
                      pairing
                    </Badge>
                    <Badge variant="info" dot>
                      inbound
                    </Badge>
                  </div>
                </div>

                {/* StatusDots */}
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    StatusDot States
                  </h3>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <StatusDot state="connected" />
                      <span className="text-sm text-muted">Connected</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusDot state="disconnected" />
                      <span className="text-sm text-muted">Disconnected</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusDot state="pairing" />
                      <span className="text-sm text-muted">Pairing</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusDot state="error" />
                      <span className="text-sm text-muted">Error</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* ════════════════════════════════════════════════════════
              Section 3: Stat Cards
              ════════════════════════════════════════════════════════ */}
          <div>
            <h2 className="mb-3 text-lg font-semibold tracking-tight">
              Stat Cards
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Messages Sent Today"
                value="1,247"
                change={{ text: "12% from yesterday", direction: "up" }}
                icon={<IconInfo size={14} />}
              />
              <StatCard
                label="Webhook Delivery Rate"
                value="99.2%"
                change={{ text: "2 failed deliveries", direction: "neutral" }}
                icon={<IconWebhook size={14} />}
              />
              <StatCard
                label="Uptime"
                value="99.97%"
                change={{ text: "Last 30 days", direction: "up" }}
                icon={<IconJobs size={14} />}
              />
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════
              Section 4: Device Status
              ════════════════════════════════════════════════════════ */}
          <div>
            <h2 className="mb-3 text-lg font-semibold tracking-tight">
              Device Status
            </h2>
            <DeviceStatus
              devices={[
                {
                  phone: "+62 812-3456-7890",
                  label: "Production · Business Account",
                  state: "connected",
                },
                {
                  phone: "+62 857-9012-3456",
                  label: "Staging · Personal Account",
                  state: "disconnected",
                },
              ]}
            />
          </div>

          {/* ════════════════════════════════════════════════════════
              Section 5: Quick Actions
              ════════════════════════════════════════════════════════ */}
          <div>
            <h2 className="mb-3 text-lg font-semibold tracking-tight">
              Quick Actions
            </h2>
            <QuickActions
              actions={[
                {
                  icon: <IconPlus size={20} />,
                  label: "Add Device",
                  href: "#",
                },
                {
                  icon: <IconInfo size={20} />,
                  label: "View Docs",
                  href: "#",
                },
                {
                  icon: <IconPlay size={20} />,
                  label: "Test Endpoint",
                  onClick: () => setModalOpen(true),
                },
              ]}
            />
          </div>

          {/* ════════════════════════════════════════════════════════
              Section 6: Alerts
              ════════════════════════════════════════════════════════ */}
          <Card>
            <CardHeader>
              <CardTitle>Alerts</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="flex flex-col gap-3">
                <Alert variant="info" icon={<IconInfo size={16} />}>
                  No webhook endpoints configured. Add one to start receiving
                  inbound messages.
                </Alert>
                <Alert variant="warning" icon={<IconWarning size={16} />}>
                  API key expires in 7 days. Rotate your keys to avoid service
                  interruption.
                </Alert>
              </div>
            </CardBody>
          </Card>

          {/* ════════════════════════════════════════════════════════
              Section 7: Forms
              ════════════════════════════════════════════════════════ */}
          <Card>
            <CardHeader>
              <CardTitle>Form Controls</CardTitle>
              <span className="text-sm text-muted">
                Default, Error, Disabled
              </span>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Default input */}
                  <FormGroup>
                    <FormLabel htmlFor="fname">Full Name</FormLabel>
                    <FormInput
                      id="fname"
                      placeholder="Jane Smith"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      error={formErrors.name}
                    />
                    {formErrors.name && (
                      <FormHint error>Full name is required</FormHint>
                    )}
                  </FormGroup>

                  {/* Error input */}
                  <FormGroup>
                    <FormLabel htmlFor="femail">Work Email</FormLabel>
                    <FormInput
                      id="femail"
                      type="email"
                      placeholder="jane@company.com"
                      value={formData.email}
                      onChange={(e) =>
                        setFormData({ ...formData, email: e.target.value })
                      }
                      error={formErrors.email}
                    />
                    {formErrors.email && (
                      <FormHint error>
                        Please enter a valid email address
                      </FormHint>
                    )}
                  </FormGroup>

                  {/* Select */}
                  <FormGroup>
                    <FormLabel htmlFor="fmethod">Method</FormLabel>
                    <FormSelect
                      id="fmethod"
                      value={formData.method}
                      onChange={(e) =>
                        setFormData({ ...formData, method: e.target.value })
                      }
                    >
                      <option>POST</option>
                      <option>GET</option>
                      <option>PUT</option>
                    </FormSelect>
                  </FormGroup>

                  {/* Disabled input */}
                  <FormGroup>
                    <FormLabel htmlFor="fdisabled">Read-only Field</FormLabel>
                    <FormInput
                      id="fdisabled"
                      value="Cannot edit this"
                      disabled
                    />
                    <FormHint>This field is disabled</FormHint>
                  </FormGroup>
                </div>

                {/* Password strength */}
                <FormGroup>
                  <FormLabel htmlFor="fpass">Password</FormLabel>
                  <FormInput
                    id="fpass"
                    type="password"
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={(e) => handlePasswordChange(e.target.value)}
                  />
                  <PasswordStrength strength={passwordStrength} />
                </FormGroup>

                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" type="button">
                    Cancel
                  </Button>
                  <Button type="submit">Save Changes</Button>
                </div>
              </form>
            </CardBody>
          </Card>

          {/* ════════════════════════════════════════════════════════
              Section 8: Toggles
              ════════════════════════════════════════════════════════ */}
          <Card>
            <CardHeader>
              <CardTitle>Toggles</CardTitle>
              <span className="text-sm text-muted">Interactive switches</span>
            </CardHeader>
            <CardBody>
              <div className="flex flex-col gap-0">
                <Toggle
                  checked={toggle1}
                  onChange={setToggle1}
                  label="Two-Factor Authentication"
                  description="Require a 6-digit code from your authenticator app on login"
                />
                <Toggle
                  checked={toggle2}
                  onChange={setToggle2}
                  label="API Key Rotation Reminder"
                  description="Get notified when keys are older than 90 days"
                />
                <Toggle
                  checked={toggleDisabled}
                  onChange={setToggleDisabled}
                  label="Disabled Toggle"
                  description="This toggle cannot be changed"
                  disabled
                />
              </div>
            </CardBody>
          </Card>

          {/* ════════════════════════════════════════════════════════
              Section 9: API Key Row
              ════════════════════════════════════════════════════════ */}
          <Card>
            <CardHeader>
              <CardTitle>API Key Management</CardTitle>
              <span className="text-sm text-muted">
                Reveal &amp; copy actions
              </span>
            </CardHeader>
            <CardBody>
              <div className="flex flex-col gap-0">
                <APIKeyRow
                  label="Production"
                  value={
                    apiRevealed
                      ? "nx_live_a8f3k2m9p1q4r7s0t5u2v8w3x6y1z4"
                      : "nx_live_••••••••••••••••••••••••••••"
                  }
                  onReveal={() => setApiRevealed(!apiRevealed)}
                  onCopy={handleCopyKey}
                />
                <APIKeyRow
                  label="Staging"
                  value="nx_test_••••••••••••••••••••••••••••"
                  onReveal={() => {}}
                  onCopy={() => {}}
                />
              </div>
              {apiCopied && (
                <div className="mt-2 text-xs text-success">
                  Key copied to clipboard!
                </div>
              )}
            </CardBody>
          </Card>

          {/* ════════════════════════════════════════════════════════
              Section 10: Table with Expandable Rows
              ════════════════════════════════════════════════════════ */}
          <Card>
            <CardHeader>
              <CardTitle>Activity Log</CardTitle>
              <span className="text-sm text-muted">Last 5 events</span>
            </CardHeader>
            <CardBody className="p-0">
              <TableWrap>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Time</TableHeaderCell>
                      <TableHeaderCell>Event</TableHeaderCell>
                      <TableHeaderCell>Device</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Details</TableHeaderCell>
                      <TableHeaderCell />
                    </TableRow>
                  </TableHead>
                  <tbody>
                    <ExpandableRow
                      detail={
                        <div className="flex flex-col gap-3">
                          <div>
                            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                              Payload
                            </h4>
                            <pre className="overflow-x-auto rounded-md border border-line bg-surface p-3 font-mono text-sm text-muted">
                              {`{
  "messaging_product": "whatsapp",
  "to": "6281234567890",
  "type": "text",
  "text": { "body": "Hello from Nexus!" }
}`}
                            </pre>
                          </div>
                          <div>
                            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                              Result
                            </h4>
                            <pre className="overflow-x-auto rounded-md border border-line bg-surface p-3 font-mono text-sm text-muted">
                              {`{
  "status": "sent",
  "wamid": "HBgCNjA4MTIzNDU2Nzg5MA=="
}`}
                            </pre>
                          </div>
                        </div>
                      }
                    >
                      <Mono>14:32:08</Mono>
                      <TableCell>message.sent</TableCell>
                      <Mono>+62 812-3456-7890</Mono>
                      <TableCell>
                        <Badge variant="success" dot>
                          delivered
                        </Badge>
                      </TableCell>
                      <Mono className="text-muted">wamid.HBg...</Mono>
                    </ExpandableRow>

                    <TableRow>
                      <Mono>14:31:45</Mono>
                      <TableCell>webhook.delivered</TableCell>
                      <Mono>—</Mono>
                      <TableCell>
                        <Badge variant="success" dot>
                          200
                        </Badge>
                      </TableCell>
                      <Mono className="text-muted">POST /hooks/inbound</Mono>
                      <TableCell />
                    </TableRow>

                    <TableRow>
                      <Mono>14:30:12</Mono>
                      <TableCell>message.received</TableCell>
                      <Mono>+62 812-3456-7890</Mono>
                      <TableCell>
                        <Badge variant="info" dot>
                          inbound
                        </Badge>
                      </TableCell>
                      <Mono className="text-muted">Template: order_update</Mono>
                      <TableCell />
                    </TableRow>

                    <TableRow>
                      <Mono>14:28:33</Mono>
                      <TableCell>webhook.failed</TableCell>
                      <Mono>—</Mono>
                      <TableCell>
                        <Badge variant="danger" dot>
                          503
                        </Badge>
                      </TableCell>
                      <Mono className="text-muted">
                        POST /hooks/inbound — timeout
                      </Mono>
                      <TableCell />
                    </TableRow>

                    <TableRow>
                      <Mono>14:25:01</Mono>
                      <TableCell>session.connected</TableCell>
                      <Mono>+62 812-3456-7890</Mono>
                      <TableCell>
                        <Badge variant="success" dot>
                          online
                        </Badge>
                      </TableCell>
                      <Mono className="text-muted">Business Account</Mono>
                      <TableCell />
                    </TableRow>
                  </tbody>
                </Table>
              </TableWrap>
            </CardBody>
          </Card>

          {/* ════════════════════════════════════════════════════════
              Section 11: Empty States
              ════════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardBody>
                <EmptyState
                  icon={<IconPhone size={28} />}
                  title="No devices paired"
                  description="Connect a WhatsApp Business account to start sending and receiving messages."
                  action={
                    <Button>
                      <IconPlus size={14} /> Add Device
                    </Button>
                  }
                />
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <EmptyState
                  icon={<IconWebhook size={28} />}
                  title="No webhooks configured"
                  description="Set up webhook endpoints to receive real-time notifications for message events and delivery updates."
                  action={
                    <Button>
                      <IconPlus size={14} /> Add Webhook
                    </Button>
                  }
                />
              </CardBody>
            </Card>
          </div>

          {/* ════════════════════════════════════════════════════════
              Section 12: Avatars
              ════════════════════════════════════════════════════════ */}
          <Card>
            <CardHeader>
              <CardTitle>Avatars</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="flex items-center gap-4">
                <Avatar initials="AZ" />
                <Avatar initials="JD" size="sm" />
                <Avatar initials="NK" className="h-12 w-12 text-base" />
              </div>
            </CardBody>
          </Card>

          {/* ════════════════════════════════════════════════════════
              Section 13: Tooltips
              ════════════════════════════════════════════════════════ */}
          <Card>
            <CardHeader>
              <CardTitle>Tooltips</CardTitle>
              <span className="text-sm text-muted">
                Hover or focus to reveal
              </span>
            </CardHeader>
            <CardBody>
              <div className="flex items-center gap-6">
                <Tooltip content="Reveal key">
                  <Button variant="icon" aria-label="Reveal key">
                    <IconEye size={14} />
                  </Button>
                </Tooltip>
                <Tooltip content="Copy to clipboard">
                  <Button variant="icon" aria-label="Copy key">
                    <IconCopy size={14} />
                  </Button>
                </Tooltip>
                <Tooltip content="Connection status">
                  <StatusDot state="connected" size={14} />
                </Tooltip>
                <span className="text-sm text-muted">
                  Tab to these buttons to see focus-visible tooltip
                </span>
              </div>
            </CardBody>
          </Card>

          {/* Footer spacer */}
          <div className="h-8" />
        </main>
      </div>

      {/* ── Interactive Modals ── */}

      {/* Test Endpoint Modal (from QuickActions) */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Test Endpoint"
      >
        <div className="flex flex-col gap-4">
          <FormGroup>
            <FormLabel htmlFor="modal-method">Method</FormLabel>
            <FormSelect id="modal-method">
              <option>POST</option>
              <option>GET</option>
              <option>PUT</option>
            </FormSelect>
          </FormGroup>
          <FormGroup>
            <FormLabel htmlFor="modal-url">URL</FormLabel>
            <FormInput
              id="modal-url"
              defaultValue="https://api.nexus.dev/v1/messages"
            />
          </FormGroup>
          <FormGroup>
            <FormLabel htmlFor="modal-payload">Payload</FormLabel>
            <textarea
              id="modal-payload"
              defaultValue='{"messaging_product":"whatsapp","to":"6281234567890","type":"text","text":{"body":"Hello from Nexus!"}}'
              className="w-full resize-y rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm text-fg outline-none transition-colors focus:border-accent h-24"
            />
          </FormGroup>
        </div>
        <ModalActions>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => setModalOpen(false)}>Send Test</Button>
        </ModalActions>
      </Modal>
    </div>
  );
}
