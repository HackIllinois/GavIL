"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { ApiError, CODE_TRIES } from "@/lib/api/client"
import { getApi } from "@/lib/api/server"
import {
    safeNext,
    SESSION_COOKIE,
    sessionCookieOptions,
} from "@/lib/auth/session"
import { verifyJudgeToken } from "@/lib/auth/verify"
import {
    CODE_COPY,
    SERVER_NOT_SET_UP,
    SIGNIN_FAILED,
    SIGNIN_FROZEN,
} from "@/lib/copy"
import { originProblem, serverEnvProblem } from "@/lib/env"

export type LoginState =
    /** `failed`: the request could not reach the server (no try or code was used): the screen offers "Try again". */
    | { step: "email"; email?: string; error?: string; failed?: "send" }
    /**
     * Signed in, and `next` is a route handler (a placard scan waiting at /t/<CODE>): the phone
     * opens it with a full navigation, so its cookies (the pending scan, the grant it mints) go
     * to and from the browser. A server-action redirect would fetch it on the server instead.
     */
    | { step: "signed-in"; to: string }
    | {
          step: "code"
          email: string
          error?: string
          /** The code check could not reach the server: no try was spent. */
          failed?: "verify"
          triesLeft: number
          locked?: boolean
      }

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Sign-in limits (CONTRACT §1): per email and event-wide, never per IP (one venue NAT). */
const AUTH_COPY = {
    recent: "We sent a code less than a minute ago. Use the newest email.",
    tooMany: (mins: number) =>
        `Too many codes for this email. Try again in ${mins} min, or go to the judging desk: staff can sign you in with a QR code.`,
    busy: "Sign-in is busy right now. Try again in a few minutes, or go to the judging desk.",
    expired: "That code expired. Send a new one.",
}

const retryMinutes = (e: ApiError) =>
    Math.max(
        1,
        Math.ceil(
            (typeof e.details.retryAfter === "number"
                ? e.details.retryAfter
                : 3600) / 60,
        ),
    )

/**
 * One action for the whole judge sign-in form (intent = send | verify | restart).
 * The email goes to adonix in the request BODY (POST /auth/judge/verify/), never a URL.
 */
export async function judgeAuth(
    prev: LoginState,
    form: FormData,
): Promise<LoginState> {
    const intent = String(form.get("intent") ?? "send")
    if (intent === "restart")
        return {
            step: "email",
            email: "email" in prev ? prev.email : undefined,
        }

    if (intent === "send") {
        const email = String(form.get("email") ?? "")
            .trim()
            .toLowerCase()
        if (!EMAIL.test(email))
            return {
                step: "email",
                email,
                error: "Enter the email you registered to judge with.",
            }
        // A server with settings missing can send nothing: an organizer's problem, not the
        // phone's connection (the same checks getApi() throws on, and /api/health reports).
        if (serverEnvProblem() !== null || originProblem() !== null)
            return { step: "email", email, error: SERVER_NOT_SET_UP }
        try {
            await (await getApi()).auth.judgeVerify(email)
        } catch (e) {
            if (e instanceof ApiError && e.code === "SignInsFrozen")
                return { step: "email", email, error: SIGNIN_FROZEN }
            // Sent less than a minute ago: the earlier code still works.
            if (e instanceof ApiError && e.code === "CodeRecent")
                return {
                    step: "code",
                    email,
                    triesLeft: CODE_TRIES,
                    error: AUTH_COPY.recent,
                }
            if (e instanceof ApiError && e.code === "TooManyCodes")
                return {
                    step: "email",
                    email,
                    error: AUTH_COPY.tooMany(retryMinutes(e)),
                }
            if (e instanceof ApiError && e.code === "SignInsBusy")
                return { step: "email", email, error: AUTH_COPY.busy }
            if (e instanceof ApiError && e.code === "BadEmail")
                return {
                    step: "email",
                    email,
                    error: "Enter the email you registered to judge with.",
                }
            return {
                step: "email",
                email,
                error: SIGNIN_FAILED.send,
                failed: "send",
            }
        }
        // adonix always reports success, so nobody can probe which emails are judges.
        return { step: "code", email, triesLeft: CODE_TRIES }
    }

    // verify
    if (prev.step !== "code") return { step: "email" }
    const code = String(form.get("code") ?? "").replace(/\D/g, "")
    const next = safeNext(String(form.get("next") ?? "")) ?? "/judge"
    if (prev.locked) return { ...prev, error: CODE_COPY.locked }
    if (code.length !== 6) return { ...prev, error: CODE_COPY.format }
    // (before the code is spent: a server that can't verify the session it would hand back must
    // not use up one of the judge's five tries)
    if (serverEnvProblem() !== null || originProblem() !== null)
        return { ...prev, error: SERVER_NOT_SET_UP }
    let jwt: string
    try {
        jwt = (await (await getApi()).auth.judgeLogin(prev.email, code)).jwt
    } catch (e) {
        if (e instanceof ApiError && e.code === "SignInsFrozen")
            return { ...prev, error: SIGNIN_FROZEN }
        if (e instanceof ApiError && e.code === "SignInsBusy")
            return { ...prev, error: AUTH_COPY.busy }
        // Expired, or no code was ever sent to this email: only a new code helps.
        if (e instanceof ApiError && e.code === "CodeExpired")
            return {
                ...prev,
                triesLeft: 0,
                locked: true,
                error: AUTH_COPY.expired,
            }
        if (e instanceof ApiError && (e.status === 403 || e.status === 429)) {
            const left =
                typeof e.details.triesLeft === "number"
                    ? e.details.triesLeft
                    : Math.max(0, prev.triesLeft - 1)
            if (left <= 0)
                return {
                    ...prev,
                    triesLeft: 0,
                    locked: true,
                    error: CODE_COPY.locked,
                }
            return { ...prev, triesLeft: left, error: CODE_COPY.wrong(left) }
        }
        if (e instanceof ApiError && e.status === 401)
            return {
                ...prev,
                error: "Your judging access was removed. See the check-in desk.",
            }
        // The check never ran, or its answer never came back: nothing was counted against the code.
        return { ...prev, error: SIGNIN_FAILED.verify, failed: "verify" }
    }
    // Verified before it becomes the session (S8): signature or an adonix round trip, `exp`
    // capped, and a JUDGE token with its event and assignment. Decoding alone installs nothing.
    const v = await verifyJudgeToken(jwt)
    if (!v.ok)
        return {
            ...prev,
            error:
                v.reason === "unreachable"
                    ? v.config
                        ? SERVER_NOT_SET_UP
                        : "Couldn’t sign in. Check your connection and try again."
                    : "Couldn’t sign in. Try again.",
        }
    ;(await cookies()).set(SESSION_COOKIE, jwt, sessionCookieOptions(v.payload))
    if (next.startsWith("/t/")) return { step: "signed-in", to: next }
    redirect(next)
}
