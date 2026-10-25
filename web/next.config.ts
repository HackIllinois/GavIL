import type { NextConfig } from "next"
import { PHASE_DEVELOPMENT_SERVER } from "next/constants"
import { baseSecurityHeaders, REFERRER_DEFAULT } from "./lib/security/headers"

export default function nextConfig(phase: string): NextConfig {
    const dev = phase === PHASE_DEVELOPMENT_SERVER
    return {
        reactStrictMode: true,
        poweredByHeader: false,
        // The middleware now sits in front of every route, /api/talk/recordings included. Next.js
        // buffers a request body for the route handler behind a middleware (default 10 MB), so an
        // unauthenticated POST could hold 10 MB in memory before the route can refuse it. The
        // route's own cap is MAX_AUDIO_BYTES + 64 KB (app/api/talk/recordings/route.ts); this is
        // just above it, so an allowed upload is never cut short and an oversize one still gets
        // the route's 413. lib/__tests__/prod-headers.test.ts keeps the two in step.
        experimental: { middlewareClientMaxBodySize: "6mb" },
        async headers() {
            // The nonce-free security headers for exactly what the middleware matcher skips (see
            // `config.matcher` in middleware.ts): Next's own build files and /_next/image, which
            // a plain `next start` serves. Every other path, dotted or not, gets the same values
            // from the middleware, with its per-request Content-Security-Policy and the path's
            // Referrer-Policy, so the two sets of paths are disjoint: OpenNext on Cloudflare
            // appends a header both set, and "same-origin, same-origin" is not a valid COOP.
            // Files Cloudflare serves from its asset store never reach either: public/_headers.
            const headers = [
                ...baseSecurityHeaders({ dev }),
                { key: "Referrer-Policy", value: REFERRER_DEFAULT },
            ]
            return [
                { source: "/_next/static/:path*", headers },
                { source: "/_next/image", headers },
            ]
        },
    }
}
