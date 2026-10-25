/**
 * Rewrites public/_headers from cloudflareHeadersFile() (lib/security/headers.ts): `npm run
 * headers:file`, from web/. Run it after changing a security header; the test in
 * lib/__tests__/prod-headers.test.ts fails while the committed file disagrees.
 *
 * It loads the TypeScript source directly, which Node can do from 22.18 (22.6 to 22.17 with
 * --experimental-strip-types, which the npm script passes).
 */
import { writeFileSync } from "node:fs"

const { cloudflareHeadersFile } = await import("./headers.ts")
const target = new URL("../../public/_headers", import.meta.url)
writeFileSync(target, cloudflareHeadersFile())
console.log(`wrote ${target.pathname}`)
