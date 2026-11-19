"use client";

import {
  Box,
  Card,
  Flex,
  Heading,
  Skeleton,
  Text,
} from "@radix-ui/themes";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <Flex align="start" justify="between" gap="4" wrap="wrap" mb="5">
      <Box>
        <Heading size="6" weight="bold" highContrast>
          {title}
        </Heading>
        {description ? (
          <Text as="p" size="2" color="gray" mt="1" style={{ maxWidth: 560 }}>
            {description}
          </Text>
        ) : null}
      </Box>
      {actions ? (
        <Flex align="center" gap="2" wrap="wrap">
          {actions}
        </Flex>
      ) : null}
    </Flex>
  );
}

export function PageStack({ children }: { children: React.ReactNode }) {
  return (
    <Flex direction="column" gap="5">
      {children}
    </Flex>
  );
}

export function Panel({
  title,
  children,
  actions,
}: {
  title?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Card size="2" variant="surface">
      {title ? (
        <Flex
          align="center"
          justify="between"
          gap="3"
          mb="3"
          pb="3"
          style={{ borderBottom: "1px solid var(--gray-a5)" }}
        >
          <Heading size="3" weight="medium">
            {title}
          </Heading>
          {actions}
        </Flex>
      ) : null}
      {children}
    </Card>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <Flex direction="column" align="center" justify="center" py="8" px="4" gap="2">
      <Text size="3" weight="medium" highContrast>
        {title}
      </Text>
      {description ? (
        <Text size="2" color="gray" align="center" style={{ maxWidth: 360 }}>
          {description}
        </Text>
      ) : null}
    </Flex>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <Flex direction="column" gap="3" py="2">
      <Skeleton height="16px" width="40%" />
      <Skeleton height="72px" width="100%" />
      <Text size="2" color="gray">
        {label}
      </Text>
    </Flex>
  );
}

export function MetricCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card size="2" variant="surface">
      <Text size="2" color="gray">
        {label}
      </Text>
      <Heading size="7" mt="2" weight="bold" highContrast>
        {value}
      </Heading>
    </Card>
  );
}
