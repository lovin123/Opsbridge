import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  href?: string;
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  /** onDark: light chip so the dark wordmark stays readable on navy/hero panels */
  tone?: "default" | "onDark";
  priority?: boolean;
  className?: string;
};

const sizes = {
  sm: { height: 28, width: 132 },
  md: { height: 36, width: 170 },
  lg: { height: 48, width: 226 },
};

export function BrandLogo({
  href = "/app",
  size = "sm",
  showWordmark = true,
  tone = "default",
  priority = false,
  className,
}: BrandLogoProps) {
  const dims = sizes[size];
  const image = (
    <Image
      src="/brand/opsbridge-logo.png"
      alt="Opsbridge"
      height={dims.height}
      width={showWordmark ? dims.width : dims.height}
      priority={priority}
      className={className}
      style={{
        height: dims.height,
        width: "auto",
        maxWidth: showWordmark ? dims.width : dims.height,
        objectFit: "contain",
        objectPosition: "left center",
        display: "block",
      }}
    />
  );

  const mark =
    tone === "onDark" ? (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          background: "#ffffff",
          borderRadius: 10,
          padding: size === "lg" ? "8px 12px" : size === "md" ? "6px 10px" : "5px 8px",
          boxShadow: "0 8px 24px rgba(2, 6, 23, 0.25)",
        }}
      >
        {image}
      </span>
    ) : (
      image
    );

  if (!href) {
    return mark;
  }

  return (
    <Link
      href={href}
      aria-label="Opsbridge home"
      style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
    >
      {mark}
    </Link>
  );
}
