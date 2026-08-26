import type { Metadata, Viewport } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { env } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: {
    default: "Tomorrow's Ash — a classless World of Warcraft realm",
    template: "%s · Tomorrow's Ash",
  },
  description:
    `A classless World of Warcraft private server. No class-locked kits — every character spends ` +
    `one shared skill budget across shared ability trees. First realm: ${env.realm.name}.`,
  applicationName: "Tomorrow's Ash",
  openGraph: {
    title: "Tomorrow's Ash",
    description: `A classless World of Warcraft realm. First realm: ${env.realm.name}.`,
    siteName: "Tomorrow's Ash",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#08080a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Fonts load at runtime rather than through next/font so that building
          the site never needs to reach the network - a homelab rebuild, an
          air-gapped CI run and a Docker image build all behave the same.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/*
          The no-page-custom-font rule is about the Pages Router's _document.js.
          This is the App Router's root layout, so the stylesheet does apply to
          every page - which is exactly what the rule wants.
        */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="antialiased">
        <div className="atmosphere atmosphere-vignette" aria-hidden="true" />
        <div className="atmosphere atmosphere-ash" aria-hidden="true" />
        <div className="atmosphere atmosphere-grain" aria-hidden="true" />

        <div className="relative z-10 flex min-h-dvh flex-col">
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
