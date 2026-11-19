"use client";

import { useQuery } from "@tanstack/react-query";
import { Grid } from "@radix-ui/themes";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSession } from "@/components/providers";
import { useCurrentOrganization } from "@/components/app-shell";
import { ApiError, api } from "@/lib/api";
import { ErrorCallout } from "@/components/ui";
import {
  LoadingBlock,
  MetricCard,
  PageHeader,
  PageStack,
  Panel,
} from "@/components/page";

interface Dashboard {
  active: number;
  critical: number;
  unassigned: number;
  overdue: number;
  resolvedToday: number;
  availableTechnicians: number;
  byStatus: Array<{ status: string; count: number }>;
  bySite: Array<{ site: string; count: number }>;
}

export default function AnalyticsPage() {
  const session = useSession();
  const current = useCurrentOrganization(session.data);
  const orgId = current?.organization.id;
  const dashboard = useQuery({
    queryKey: ["dashboard", orgId],
    enabled: Boolean(orgId),
    queryFn: () => api<Dashboard>("/dashboard", { orgId }),
  });

  if (dashboard.isError) {
    return (
      <ErrorCallout>
        {dashboard.error instanceof ApiError
          ? dashboard.error.message
          : "Could not load analytics."}
      </ErrorCallout>
    );
  }

  if (!dashboard.data) {
    return <LoadingBlock label="Loading analytics…" />;
  }

  const data = dashboard.data;

  const stats = [
    { label: "Active", value: data.active },
    { label: "Critical", value: data.critical },
    { label: "Unassigned", value: data.unassigned },
    { label: "Overdue", value: data.overdue },
    { label: "Resolved today", value: data.resolvedToday },
    { label: "Available", value: data.availableTechnicians },
  ];

  return (
    <PageStack>
      <PageHeader title="Analytics" description="Incident metrics and trends." />
      <Grid columns={{ initial: "2", md: "3", xl: "6" }} gap="4">
        {stats.map(({ label, value }) => (
          <MetricCard key={label} label={label} value={value} />
        ))}
      </Grid>
      <Grid columns={{ initial: "1", xl: "2" }} gap="4">
        <Panel title="By status">
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byStatus}>
                <CartesianGrid vertical={false} stroke="var(--gray-a5)" />
                <XAxis dataKey="status" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#334155" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="By site">
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.bySite}>
                <CartesianGrid vertical={false} stroke="var(--gray-a5)" />
                <XAxis dataKey="site" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#0F766E" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </Grid>
    </PageStack>
  );
}
