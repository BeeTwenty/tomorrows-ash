import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Ashmorrow admin",
    template: "%s · Ashmorrow admin",
  },
  description: "Operator panel for realm Ashmorrow.",
  // Belt and braces with the X-Robots-Tag header in next.config.ts. A panel
  // that turns up in a search result has already lost something.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  themeColor: "#07070a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
