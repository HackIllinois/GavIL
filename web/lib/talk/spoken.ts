/**
 * A project's name as it may be heard (shared by the plea rules, which cannot import extract.ts).
 */
import { foldText } from "./fold"

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * A project's name as it may be heard, as a regex source: "EcoLens" → eco lens / ecolens /
 * eco-lens; "Lumen.ai" → lumen ai / lumen.ai / lumen dot ai. Folded first (look-alike letters).
 * null for a name too short to be a subject (under 3 letters), never a wildcard.
 */
export function spokenName(name: string | null | undefined): string | null {
    const tokens = foldText(name)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
    if (tokens.join("").length < 3) return null
    return tokens.map(escapeRe).join(String.raw`(?:[\s.'-]*|\s+dot\s+)`)
}
