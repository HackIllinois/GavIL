import { ButtonLink } from "@/components"

/** "My notes" lives in the app bar on every in-judging screen (judge rule 5). */
export function NotesButton({ from }: { from: string }) {
    return (
        <ButtonLink
            href={`/judge/notes?from=${encodeURIComponent(from)}`}
            variant="ghost"
            icon="notes"
        >
            My notes
        </ButtonLink>
    )
}
