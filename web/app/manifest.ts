import type { MetadataRoute } from "next"
import { webManifest } from "@/lib/security/install"

/** Served at /manifest.webmanifest and linked from every page by Next.js. */
export default function manifest(): MetadataRoute.Manifest {
    return webManifest()
}
