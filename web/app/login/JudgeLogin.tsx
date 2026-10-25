"use client"

import { useActionState, useEffect } from "react"
import { Button, ButtonLink, Icon } from "@/components"
import { DeskScan } from "./DeskScan"
import { judgeAuth, type LoginState } from "./actions"

/** Sign-in card, matching the JudgePrototype "signin" screen and its states. */
export function JudgeLogin({ next }: { next?: string }) {
    const [state, act, busy] = useActionState(judgeAuth, {
        step: "email",
    } as LoginState)
    // Back to the placard that was scanned before signing in: a full navigation (see LoginState).
    const to = state.step === "signed-in" ? state.to : null
    useEffect(() => {
        if (to) window.location.assign(to)
    }, [to])

    if (state.step === "signed-in") {
        return (
            <div role="status" className="gv-stack">
                <div className="gv-card__title" style={{ margin: 0 }}>
                    <Icon name="check" />
                    Signed in. Opening your table…
                </div>
                <ButtonLink href={state.to} block>
                    Open it now
                </ButtonLink>
            </div>
        )
    }

    if (state.step === "code") {
        return (
            <div role="status" className="gj-sent">
                <div className="gv-card__title" style={{ margin: 0 }}>
                    <Icon name="check" />
                    {"Link sent to " + state.email}
                </div>
                <p className="gj-p-soft">
                    It works once and expires in 15 minutes. Open it on this
                    phone.
                </p>
                <div className="gv-or">or type the code from the email</div>
                <form action={act} className="gj-sent" noValidate>
                    <input type="hidden" name="next" value={next ?? ""} />
                    <div className="gj-field">
                        <label htmlFor="code">6-digit code</label>
                        <input
                            id="code"
                            name="code"
                            className="gj-code"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            spellCheck={false}
                            maxLength={6}
                            disabled={state.locked}
                            aria-invalid={!!state.error}
                            aria-describedby={
                                state.error ? "code-error" : undefined
                            }
                        />
                        {state.error && (
                            <p
                                className="gj-field__err"
                                id="code-error"
                                role="alert"
                            >
                                {state.error}
                            </p>
                        )}
                    </div>
                    {state.locked ? (
                        <Button
                            type="submit"
                            name="intent"
                            value="restart"
                            variant="secondary"
                            block
                        >
                            Send a new code
                        </Button>
                    ) : (
                        <Button
                            type="submit"
                            name="intent"
                            value="verify"
                            variant="secondary"
                            block
                            loading={busy}
                        >
                            {busy ? "Signing in…" : "Sign in with code"}
                        </Button>
                    )}
                    {!state.locked && (
                        <Button
                            type="submit"
                            name="intent"
                            value="restart"
                            variant="ghost"
                            block
                        >
                            Use a different email
                        </Button>
                    )}
                </form>
            </div>
        )
    }

    return (
        <>
            <form action={act} className="gv-stack" noValidate>
                <div className="gj-field">
                    <label htmlFor="email">Email</label>
                    <input
                        id="email"
                        name="email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        autoCapitalize="off"
                        spellCheck={false}
                        placeholder="you@company.com"
                        defaultValue={state.email}
                        aria-invalid={!!state.error}
                        aria-describedby={
                            state.error ? "email-error" : undefined
                        }
                    />
                    {state.error && (
                        <p
                            className="gj-field__err"
                            id="email-error"
                            role="alert"
                        >
                            {state.error}
                        </p>
                    )}
                </div>
                <Button
                    type="submit"
                    name="intent"
                    value="send"
                    size="lg"
                    block
                    iconRight="arrow"
                    loading={busy}
                >
                    {busy ? "Sending…" : "Email me a sign-in link"}
                </Button>
            </form>
            <div className="gv-or">or</div>
            <DeskScan />
        </>
    )
}
