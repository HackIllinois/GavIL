/**
 * What an error boundary says (app/error.tsx, app/judge/error.tsx, app/admin/error.tsx). Pure,
 * so the words are tested. Never the error's own message or stack: in production Next.js strips
 * a server error to a digest anyway, and a client error's message can name internals, notes or
 * URLs. The digest (an opaque hash) is the only thing shown, and only to staff.
 *
 * `online` is `navigator.onLine`: a phone with no Wi-Fi gets "You’re offline" and what happens to
 * its work, not a server-problem message it cannot act on.
 */
export type ErrorScope = "app" | "judge" | "admin"

export interface ErrorCopy {
    title: string
    body: string
}

const SAFE_REF = /^[A-Za-z0-9_-]{1,32}$/

export function errorCopy(
    scope: ErrorScope,
    online: boolean,
    digest?: string,
): ErrorCopy {
    if (!online)
        return {
            title: "You’re offline",
            body:
                scope === "judge"
                    ? "Your notes and votes stay on this phone and send once you reconnect. This screen needs a connection: reconnect, then try again."
                    : "Nothing was changed. This screen needs a connection: reconnect, then try again.",
        }
    switch (scope) {
        case "judge":
            return {
                title: "Couldn’t load this screen",
                body: "Your notes and votes are safe. Check your connection, then try again. If it keeps happening, find a staff member in an orange shirt.",
            }
        case "admin": {
            const ref =
                digest && SAFE_REF.test(digest) ? ` (ref ${digest})` : ""
            return {
                title: "Couldn’t load this section",
                body: `adonix didn’t answer or refused the request${ref}. Nothing was changed. Try again; if it persists, check your role in Settings.`,
            }
        }
        default:
            return {
                title: "Something went wrong",
                body: "Nothing was lost. Try again.",
            }
    }
}
