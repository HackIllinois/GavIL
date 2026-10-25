/**
 * Gav-IL components: typed React 19 ports of design-system/components/bundle.js with identical
 * gv-* class names, ARIA and behavior (the design system stays the source of truth: change it, run
 * `npm run sync`, and these follow). Styles come from app/styles/gavil.css (synced from
 * bundle.css) and the art from /brand/ (synced from assets/brand/); the helpers they share live in
 * lib/ (motion, view-transition, haptics, focus, art, qr, scan, talk/*).
 *
 * Server and client: a Server Component page may import any of these from "@/components". The
 * presentational ones (Badge, Icon, Card, ProjectHeader, StatTile, StatusBadge, ProjectSkeleton,
 * RecallBlock, CoverageMeter, ActionBar, TablePlacard's data) render on the server; everything with
 * state, effects or handlers is a "use client" module, so props that cross the boundary must be
 * serializable (no callbacks from a server page). lib/__tests__/cweb-boundaries.test.ts guards it.
 *
 * Wiring cheat sheet (the Table talk judge screen):
 *   const { session, snap } = useTableTalk({ scope, projectId, projectName, mode: "table",
 *       engine: mock ? "fixture" : "mic", maxSeconds: me.talk.maxSeconds,
 *       gate: { eventEnabled: me.talk.enabled, projectOptedOut: project.recordingOptOut,
 *               placard: arrivedBy === "scan" || arrivedBy === "typed", byName: arrivedBy === "name",
 *               ai: me.talk.llm },
 *       notes: () => notesRef.current })
 *   <TableTalkCard session={session} onNominate={(prize) => toggleChip(prize)} />   // inside the evaluate screen
 *   <DemoStatus value={snap.demo} suggested={snap.demoSuggested} onChange={session.setDemo} />
 *   setTalkDraft(scope, projectId, snap.draft ?? null)                               // for the evaluation write
 *   Submit:  await session.settle()  then  write with session.getSnapshot().draft
 *   Skip, sign-out, Round 1 end:  dropSessions(scope, projectId?)  (lib/talk/registry.ts)
 *   Every screen's app bar:  recording={useActiveRecording(scope)} + onShow -> the evaluate screen
 *   Lock changes (event switch, opt-out, placard) are just new `gate` values: a running recording stops.
 * The right-table check: <TableCheck .../> controlled by the screen (state + result from the arrive
 *   answer), `useQrScanner` for onScan / scanLive; <EnRoute/> before it; <TablePlacard/> and
 *   <PlacardSheet/> (placardProps(adminPlacard)) for staff.
 */
export { ActionBar, type ActionBarProps } from "./ActionBar"
export {
    AdmissionsTable,
    type AdmissionsRow,
    type AdmissionsTableProps,
} from "./AdmissionsTable"
export { Badge, PathBadge, type BadgeProps, type BadgeTone } from "./Badge"
export { Brand, type BrandName, type BrandProps } from "./Brand"
export {
    Button,
    ButtonLink,
    buttonClass,
    type ButtonLinkProps,
    type ButtonProps,
    type ButtonShape,
    type ButtonSize,
    type ButtonVariant,
} from "./Button"
export { Card, type CardProps } from "./Card"
export { ChoiceChips, type ChoiceChipsProps } from "./ChoiceChips"
export {
    CompareCard,
    type CompareCardProps,
    type CompareProject,
} from "./CompareCard"
export { ComparePair, type ComparePairProps, type Side } from "./ComparePair"
export { ConsentSheet, type ConsentSheetProps } from "./ConsentSheet"
export {
    CoverageMeter,
    type CoverageMeterProps,
    type CoverageMeterRoom,
} from "./CoverageMeter"
export {
    DeliberationBoard,
    type DeliberationBoardProps,
    type DeliberationNominee,
} from "./DeliberationBoard"
export {
    DemoStatus,
    type DemoStatusProps,
    type DemoStatusValue,
} from "./DemoStatus"
export { Disclosure, type DisclosureProps } from "./Disclosure"
export { EmptyState, type EmptyStateProps } from "./EmptyState"
export { EnRoute, firstNames, type EnRouteProps } from "./EnRoute"
export { FlagCard, type FlagCardProps } from "./FlagCard"
export { Garland, type GarlandProps } from "./Garland"
export {
    HighlightList,
    type Highlight,
    type HighlightListProps,
    type PrizeSuggestionRow,
} from "./HighlightList"
export {
    Icon,
    ICON_PATHS,
    iconSize,
    type IconName,
    type IconProps,
    type IconSize,
} from "./Icon"
export { InlineConfirm, type InlineConfirmProps } from "./InlineConfirm"
export {
    JudgeShell,
    RecTag,
    UnsentTag,
    type JudgeShellProps,
} from "./JudgeShell"
export { LevelMeter, type LevelMeterProps } from "./LevelMeter"
export {
    NominationPicker,
    type NominationPickerProps,
    type PrizeOption,
} from "./NominationPicker"
export {
    NotesField,
    type NotesFieldProps,
    type NotesStatus,
} from "./NotesField"
export { OfflineBanner, type OfflineBannerProps } from "./OfflineBanner"
export { PlacardSheet, type PlacardSheetProps } from "./PlacardSheet"
export { ProjectHeader, type ProjectHeaderProps } from "./ProjectHeader"
export { ProjectSkeleton, type ProjectSkeletonProps } from "./ProjectSkeleton"
export { Prop, type PropName, type PropProps } from "./Prop"
export { QR, type QRProps } from "./QR"
export { RecallBlock, type RecallBlockProps } from "./RecallBlock"
export { ScoreBar, type ScoreBarProps } from "./ScoreBar"
export { Sheet, type SheetClose, type SheetProps } from "./Sheet"
export {
    SkipSheet,
    SKIP_LEDE,
    SKIP_REASONS,
    type SkipSheetProps,
} from "./SkipSheet"
export { StatTile } from "./StatTile"
export { StatusBadge } from "./StatusBadge"
export { Switch, type SwitchProps } from "./Switch"
export {
    TableCheck,
    cleanCode,
    codeDisplay,
    type TableCheckInput,
    type TableCheckProps,
    type TableCheckResult,
    type TableCheckState,
} from "./TableCheck"
export {
    TablePlacard,
    placardProps,
    type TablePlacardProps,
} from "./TablePlacard"
export { TableProgress, type TableProgressProps } from "./TableProgress"
export {
    TableTalk,
    type TableTalkProps,
    type TableTalkState,
} from "./TableTalk"
export { Tabs, type TabItem, type TabsProps } from "./Tabs"
export { TimerBar, type TimerBarProps } from "./TimerBar"
export { Toast, type ToastProps, type ToastTone } from "./Toast"
export { ToggleChip, type ToggleChipProps } from "./ToggleChip"
export {
    Wayfinding,
    type SignArtState,
    type WayfindingProps,
} from "./Wayfinding"
export { TableTalkCard, type TableTalkCardProps } from "./TableTalkCard"
export {
    useActiveRecording,
    useTableTalk,
    useTalkLive,
    type ActiveRecording,
    type UseTableTalkOptions,
} from "./useTableTalk"
export {
    useQrScanner,
    type QrScanner,
    type UseQrScannerOptions,
} from "./useQrScanner"
export { useSwapNavigate } from "./useSwapNavigate"
export { useToast } from "./useToast"

// The helpers the components share, for screens that need them too (their home is lib/). `swap` (View
// Transitions, needs react-dom) is lib/view-transition.ts: a Server Component graph must not import it.
export { art, prefetchArt } from "@/lib/art"
export { keepFocus, tapShield } from "@/lib/focus"
export { haptic } from "@/lib/haptics"
export { motionOK, tokenMs } from "@/lib/motion"
