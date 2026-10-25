import type { CSSProperties, ReactNode } from "react"
import { Toast, type ToastTone } from "./Toast"

export interface ActionBarProps {
    /** A toast floats above the bar (`""` keeps the slot mounted with nothing in it). */
    toast?: string
    toastId?: string | number
    toastTone?: ToastTone
    style?: CSSProperties
    children?: ReactNode
}

/** Sticky bottom bar on ground-deep. A primary Button inside stretches. */
export function ActionBar({
    toast,
    toastId,
    toastTone,
    style,
    children,
}: ActionBarProps) {
    return (
        <div className="gv-actionbar" style={style}>
            {toast !== undefined && (
                <Toast message={toast} id={toastId} tone={toastTone} />
            )}
            {children}
        </div>
    )
}
