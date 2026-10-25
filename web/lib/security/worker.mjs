/**
 * The Worker's entry (wrangler.jsonc `main`): OpenNext's generated handler, wrapped so that every
 * response, including the ones the framework answers before any app code runs, carries the
 * security headers (lib/security/edge-headers.ts). Nothing else changes: the request goes through
 * OpenNext untouched.
 *
 * `.open-next/worker.js` exists after `npm run build:worker` (opennextjs-cloudflare build); wrangler
 * bundles it from here when it previews or deploys. The Durable Object classes are re-exported
 * because OpenNext's caching add-ons (R2 incremental cache, tag cache) bind to them by name if
 * the project ever turns those on.
 */
import openNext from "../../.open-next/worker.js"
import { hardenResponse } from "./edge-headers"

export {
    BucketCachePurge,
    DOQueueHandler,
    DOShardedTagCache,
} from "../../.open-next/worker.js"

const worker = {
    async fetch(request, env, ctx) {
        const response = await openNext.fetch(request, env, ctx)
        return hardenResponse(response, new URL(request.url).pathname)
    },
}

export default worker
