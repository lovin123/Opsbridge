import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const opsbridgeSans = IBM_Plex_Sans({
  variable: "--font-opsbridge",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Opsbridge",
    template: "%s · Opsbridge",
  },
  description:
    "Opsbridge bridges field operations—incidents, shifts, sites, and crews—in one reliable workspace.",
  applicationName: "Opsbridge",
  keywords: [
    "Opsbridge",
    "field operations",
    "workforce",
    "incidents",
    "shifts",
    "Nexconn",
  ],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48 64x64" },
      { url: "/brand/opsbridge-icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/opsbridge-icon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"],
  },
  openGraph: {
    title: "Opsbridge",
    description:
      "Bridge every field team in one workspace—incidents, shifts, sites, and real-time coordination.",
    siteName: "Opsbridge",
    images: [
      {
        url: "/brand/opsbridge-icon-512.png",
        width: 512,
        height: 512,
        alt: "Opsbridge",
      },
    ],
  },

};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${opsbridgeSans.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
        <div id="nexconn-modal-root" />
      </body>
    </html>
  );
}
