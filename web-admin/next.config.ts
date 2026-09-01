import path from "node:path";
import type { NextConfig } from "next";

/**
 * The admin panel's Content-Security-Policy is stricter than the public site's:
 * no external origins at all. It loads no web fonts and no third-party anything,
 * so nothing needs to be allowed beyond 'self'.
 *
 * `frame-ancestors 'none'` matters more here than on the public site - this is
 * the surface where clickjacking would be worth someone's trouble.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "connect-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,

  // SRP6, the account-name/password limits and the WoW reference tables are
  // imported from the public site rather than copied. Those modules are pure
  // and must never diverge - two implementations of SRP6 is exactly the second
  // source of truth this project keeps refusing to create. Everything with a
  // security policy in it (db, session, env) is deliberately NOT shared: the
  // admin versions are stricter.
  outputFileTracingRoot: path.join(__dirname, ".."),

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // The admin panel must never leak a target's name or id in a referer.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // Nothing here is ever cacheable by a shared cache.
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default nextConfig;
