"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  Avatar,
  Badge,
  Box,
  Button,
  DropdownMenu,
  Flex,
  IconButton,
  Select,
  Separator,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import {
  BarChart3,
  Bell,
  Building2,
  ClipboardList,
  Clock,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MessagesSquare,
  Settings,
  Users,
  X,
} from "lucide-react";
import { type Permission, type SessionResponse } from "@fieldops/shared";
import { BrandLogo } from "@/components/brand-logo";
import { destroyNexconnSession, NexconnSession, useNexconnStatus } from "@/components/nexconn-chat";
import { NexconnCallOverlay } from "@/components/nexconn-call-overlay";
import { ApiError, api } from "@/lib/api";
import { membershipHasPermission } from "@/lib/permissions";
import { useSession } from "@/components/providers";
import { useUiStore } from "@/store/ui-store";
import { ErrorCallout } from "@/components/ui";

const links: Array<{
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
}> = [
  { href: "/app", label: "Overview", icon: LayoutDashboard },
  { href: "/app/incidents", label: "Incidents", icon: ClipboardList, permission: "incidents.view" },
  { href: "/app/workforce", label: "Workforce", icon: Users, permission: "org.members.manage" },
  { href: "/app/shifts", label: "Shifts", icon: Clock, permission: "shifts.view" },
  { href: "/app/teams", label: "Teams", icon: Building2, permission: "teams.view" },
  { href: "/app/sites", label: "Sites", icon: MapPin, permission: "sites.view" },
  {
    href: "/app/communications",
    label: "Communications",
    icon: MessagesSquare,
    permission: "communications.view",
  },
  { href: "/app/notifications", label: "Notifications", icon: Bell },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3, permission: "analytics.view" },
  { href: "/app/settings", label: "Settings", icon: Settings, permission: "org.settings.manage" },
];

function connectionColor(status: string): "indigo" | "amber" | "red" | "gray" {
  const value = status.toLowerCase();
  if (value.includes("connected") || value === "ready" || value === "online") return "indigo";
  if (value.includes("connect") || value.includes("reconnect") || value.includes("boot")) return "amber";
  if (value.includes("fail") || value.includes("error") || value.includes("disconnect")) return "red";
  return "gray";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const connection = useNexconnStatus();
  const router = useRouter();
  const pathname = usePathname();
  const organizationId = useUiStore((state) => state.organizationId);
  const setOrganizationId = useUiStore((state) => state.setOrganizationId);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const unread = useQuery({
    queryKey: ["notifications-unread", organizationId],
    enabled: Boolean(organizationId && session.data),
    refetchInterval: 30_000,
    queryFn: () => api<{ count: number }>("/notifications/unread-count", { orgId: organizationId }),
  });

  useEffect(() => {
    if (session.isSuccess && session.data === null) {
      router.replace("/sign-in");
    }
  }, [session.isSuccess, session.data, router]);

  useEffect(() => {
    const memberships = session.data?.memberships ?? [];
    if (!session.data) {
      return;
    }
    if (memberships.length === 0) {
      router.replace("/onboarding");
      return;
    }
    if (!organizationId || !memberships.some((item) => item.organization.id === organizationId)) {
      setOrganizationId(memberships[0].organization.id);
    }
  }, [session.data, organizationId, router, setOrganizationId]);

  if (session.isError) {
    return (
      <Flex align="center" justify="center" minHeight="100vh" p="6">
        <Box style={{ maxWidth: 420 }} width="100%">
          <ErrorCallout>
            {session.error instanceof ApiError ? session.error.message : "Could not load your session."}
          </ErrorCallout>
          <Button mt="3" variant="soft" onClick={() => void session.refetch()}>
            Retry
          </Button>
        </Box>
      </Flex>
    );
  }

  if (!session.data || session.data.memberships.length === 0) {
    return (
      <Flex align="center" justify="center" minHeight="100vh">
        <Text size="2" color="gray">
          Loading Opsbridge…
        </Text>
      </Flex>
    );
  }

  const current =
    session.data.memberships.find((item) => item.organization.id === organizationId) ??
    session.data.memberships[0];
  const unreadCount = unread.data?.count ?? 0;

  return (
    <div className="app-shell">
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <aside className={sidebarOpen ? "sidebar sidebar-open" : "sidebar sidebar-closed"}>
        <div className="sidebar-inner">
          <div className="sidebar-brand">
            <BrandLogo href="/app" size="md" className="sidebar-brand-link" />
            <IconButton
              variant="ghost"
              color="gray"
              aria-label="Close menu"
              className="sidebar-close"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={16} />
            </IconButton>
          </div>

          <nav className="sidebar-nav" aria-label="Workspace">
            {links
              .filter(
                (link) =>
                  !link.permission || membershipHasPermission(current, link.permission),
              )
              .map((link) => {
              const active =
                pathname === link.href || (link.href !== "/app" && pathname.startsWith(link.href));
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setSidebarOpen(false)}
                  className={active ? "sidebar-link is-active" : "sidebar-link"}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={18} strokeWidth={1.75} className="sidebar-link-icon" aria-hidden />
                  <span className="sidebar-link-label">{link.label}</span>
                  {link.href === "/app/notifications" && unreadCount > 0 ? (
                    <Badge size="1" variant="solid" highContrast>
                      {unreadCount}
                    </Badge>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <Separator size="4" />
            <Text size="1" color="gray" as="p" mt="3">
              {current.orgRoleName}
            </Text>
            <Text size="2" weight="medium" highContrast as="p" mt="1">
              {current.organization.name}
            </Text>
          </div>
        </div>
      </aside>

      <Flex direction="column" minWidth="0" style={{ minHeight: "100vh" }} className="app-main">
        <Box
          position="sticky"
          top="0"
          style={{
            zIndex: 20,
            borderBottom: "1px solid var(--gray-a5)",
            background: "color-mix(in oklab, var(--color-panel-solid) 88%, transparent)",
            backdropFilter: "blur(10px)",
          }}
        >
          <Flex align="center" justify="between" gap="4" px={{ initial: "4", lg: "6" }} height="64px">
            <Flex align="center" gap="3" minWidth="0">
              <Box display={{ initial: "block", lg: "none" }}>
                <IconButton
                  variant="ghost"
                  color="gray"
                  aria-label="Open navigation"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu size={18} />
                </IconButton>
              </Box>
              {session.data.memberships.length > 1 ? (
                <Select.Root value={current.organization.id} onValueChange={setOrganizationId}>
                  <Select.Trigger variant="surface" placeholder="Organization" />
                  <Select.Content position="popper">
                    {session.data.memberships.map((membership) => (
                      <Select.Item key={membership.organization.id} value={membership.organization.id}>
                        {membership.organization.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              ) : (
                <Text size="2" weight="medium" highContrast truncate>
                  {current.organization.name}
                </Text>
              )}
            </Flex>

            <Flex align="center" gap="3">
              <Tooltip content={`Nexconn ${connection}`}>
                <Badge color={connectionColor(connection)} variant="soft">
                  Nexconn · {connection}
                </Badge>
              </Tooltip>
              <NexconnSession />
              <NexconnCallOverlay />
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <Button variant="ghost" color="gray" highContrast>
                    <Avatar
                      size="2"
                      radius="full"
                      fallback={session.data.user.name.slice(0, 2).toUpperCase()}
                      color="indigo"
                    />
                    <Box display={{ initial: "none", sm: "block" }} style={{ textAlign: "left" }}>
                      <Text size="2" weight="medium" highContrast style={{ display: "block" }}>
                        {session.data.user.name}
                      </Text>
                      <Text size="1" color="gray">
                        {current.orgRoleName}
                      </Text>
                    </Box>
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end" sideOffset={6}>
                  <DropdownMenu.Item asChild>
                    <Link href="/app/profile">Profile</Link>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item asChild>
                    <Link href="/app/settings">Settings</Link>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <SignOutMenuItem />
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Flex>
          </Flex>
        </Box>

        <Box asChild px={{ initial: "4", lg: "6" }} py={{ initial: "5", lg: "6" }} style={{ flex: 1 }}>
          <main>{children}</main>
        </Box>
      </Flex>
    </div>
  );
}

function SignOutMenuItem() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return (
    <DropdownMenu.Item
      color="red"
      onSelect={() => {
        void (async () => {
          try {
            await destroyNexconnSession();
            await api("/auth/signout", { method: "POST" });
          } finally {
            queryClient.clear();
            router.replace("/sign-in");
          }
        })();
      }}
    >
      <LogOut size={14} />
      Sign out
    </DropdownMenu.Item>
  );
}

export function useCurrentOrganization(session: SessionResponse | null | undefined) {
  const organizationId = useUiStore((state) => state.organizationId);
  return (
    session?.memberships.find((item) => item.organization.id === organizationId) ??
    session?.memberships[0]
  );
}
