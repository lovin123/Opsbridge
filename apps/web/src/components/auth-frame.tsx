import Link from "next/link";
import { Box, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { BrandLogo } from "@/components/brand-logo";

export function AuthFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      minHeight="100vh"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.1fr) minmax(420px, 560px)",
      }}
      className="auth-shell"
    >
      <Box
        display={{ initial: "none", lg: "block" }}
        p="8"
        style={{
          background:
            "linear-gradient(155deg, #07111f 0%, #0b1f3a 42%, #1e3a8a 100%), radial-gradient(800px 420px at 18% 18%, rgba(59, 130, 246, 0.28), transparent 60%)",
          color: "white",
        }}
      >
        <Flex direction="column" justify="between" height="100%" style={{ minHeight: "calc(100vh - 4rem)" }}>
          <BrandLogo href="/" size="lg" tone="onDark" priority />
          <Box style={{ maxWidth: 460 }}>
            <Heading size="8" weight="bold" highContrast style={{ lineHeight: 1.1, color: "white" }}>
              Operations, bridged in one workspace.
            </Heading>
            <Text as="p" size="3" mt="4" style={{ color: "rgba(219, 234, 254, 0.82)", lineHeight: 1.6 }}>
              Connect incidents, shifts, sites, and crews with real-time coordination your field teams can trust.
            </Text>
          </Box>
          <Text size="2" style={{ color: "rgba(191, 219, 254, 0.72)" }}>
            Workforce operations platform
          </Text>
        </Flex>
      </Box>

      <Flex align="center" justify="center" px="5" py="8" style={{ background: "var(--gray-1)" }}>
        <Box width="100%" style={{ maxWidth: 420 }}>
          <Box mb="4" className="auth-brand-mobile">
            <BrandLogo href="/" size="sm" priority />
          </Box>
          <Card size="3" variant="surface">
            <Heading size="6" weight="bold" highContrast mb="1">
              {title}
            </Heading>
            <Text as="p" size="2" color="gray" mb="5">
              {subtitle}
            </Text>
            {children}
          </Card>
          <Text as="p" size="1" color="gray" mt="4">
            <Link href="/" style={{ color: "inherit", textDecoration: "none" }}>
              Opsbridge
            </Link>
            {" · "}
            Bridge every field team in one place.
          </Text>
        </Box>
      </Flex>
      <style>{`
        @media (max-width: 1023px) {
          .auth-shell {
            grid-template-columns: 1fr !important;
          }
        }
        @media (min-width: 1024px) {
          .auth-brand-mobile { display: none; }
        }
      `}</style>
    </Box>
  );
}
