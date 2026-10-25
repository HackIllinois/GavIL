import type * as React from 'react';
export type IconName = 'clock'|'pin'|'table'|'chevron'|'up'|'check'|'plus'|'skip'|'notes'|'flag'|'alert'|'user'|'users'|'trophy'|'lock'|'arrow'|'external'|'code'|'doc'|'map'|'git'|'shield'|'inbox'|'star'|'horseshoe'|'signpost'|'mic'|'mic-off'|'pause'|'play'|'square'|'bookmark'|'quote'|'qr-code'|'scan-line'|'printer'|'rotate-ccw'|'trash'|'hourglass'|'pencil'|'zap';
export type Path = 'pro'|'general';
export type HapticKind = 'tap'|'success'|'warn'|'urgent'|'over'|'go'|'error';
export interface Recall { does?: string|null; demo?: string|null; standout?: string|null; open?: string|null }
export interface Project { name: string; path: Path; table: number|string; description?: string; notes?: string; nominations?: string[]; recall?: Recall|null }
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary'|'secondary'|'ghost'|'ghost-danger'|'danger'|'wood'; size?: 'sm'|'md'|'lg'; shape?: 'chamfer'|'back'|'next'; block?: boolean; icon?: IconName; iconRight?: IconName; loading?: boolean; settle?: boolean; settleKey?: string|number; btnRef?: React.Ref<HTMLButtonElement> }
export interface BadgeProps { tone?: 'neutral'|'pro'|'general'|'brand'|'warn'|'danger'|'success'; mono?: boolean; icon?: IconName; className?: string; children?: React.ReactNode }
export interface PathBadgeProps { path: Path }
/** A token name (`--icon-<size>` in tokens.json), never pixels: xs 12, compact 14, sm 16 (default), wide 18, md 20, lg 24. */
export type IconSize = 'xs'|'compact'|'sm'|'wide'|'md'|'lg';
export interface IconProps { name: IconName; size?: IconSize; strokeWidth?: number; className?: string }
export interface ToggleChipProps { selected?: boolean; defaultSelected?: boolean; onChange?: (on: boolean) => void; disabled?: boolean; children?: React.ReactNode }
/** Name the group with `label` or `labelledBy` (one is required; an unnamed group falls back to "Choose one"). */
export type ChoiceChipsProps = { options: string[]; value?: string|null; defaultValue?: string; onChange?: (value: string) => void; disabled?: boolean } & ({ label: string; labelledBy?: undefined } | { labelledBy: string; label?: undefined });
export interface NominationPickerProps { prizes: string[]; value?: string[]; defaultSelected?: string[]; onChange?: (names: string[]) => void; label?: string; hint?: string; disabled?: boolean }
export interface CardProps { title?: React.ReactNode; icon?: IconName; aside?: React.ReactNode; as?: 'h1'|'h2'|'h3'|'h4'; flush?: boolean; className?: string; style?: React.CSSProperties; children?: React.ReactNode }
export interface TimerBarProps { secondsLeft?: number; totalSeconds: number; live?: boolean; endsAt?: number; label?: string; warnAt?: number; urgentAt?: number; right?: React.ReactNode; onExpire?: () => void; haptics?: boolean }
export interface WayfindingProps { room: string; table?: string|number; label?: string; hint?: string; noun?: string; size?: 'inline'|'hero'; board?: React.ReactNode; boardLabel?: string; mapLabel?: string|false; mapHref?: string; onMap?: (e: React.MouseEvent) => void; icon?: IconName; artState?: 'loading'|'ready'|'failed' }
export interface ProjectHeaderProps { name: string; path: Path; table: number|string; room: string; tracks?: string[]; tagline?: string; eyebrow?: string|false; seen?: number; showLocation?: boolean; as?: 'h1'|'h2'|'h3' }
export interface ProjectSkeletonProps { label?: string; rows?: number }
export interface DisclosureProps { title: string; icon?: IconName; meta?: string; open?: boolean; onToggle?: (open: boolean) => void; defaultOpen?: boolean; children?: React.ReactNode }
export interface NotesFieldProps { value?: string; defaultValue?: string; onChange?: (text: string) => void; onSave?: (text: string, version: number) => void | 'local' | Promise<unknown>; syncKey?: string|number; status?: 'idle'|'saved'|'local'|'error'; label?: string; placeholder?: string; rows?: number; disabled?: boolean }
export interface ActionBarProps { toast?: string; toastId?: string|number; toastTone?: ToastProps['tone']; style?: React.CSSProperties; children?: React.ReactNode }
export interface ToastProps { message?: string; id?: string|number; tone?: 'success'|'warn'|'danger'; icon?: IconName }
export interface CompareCardProps { project: Project; selected?: boolean; onSelect?: (e: React.SyntheticEvent) => void; order?: string; tabIndex?: number; disabled?: boolean; btnRef?: React.Ref<HTMLDivElement>; onKeyDown?: (e: React.KeyboardEvent) => void }
export interface ComparePairProps { a: Project; b: Project; defaultSelected?: 'a'|'b'; recorded?: 'a'|'b'|null; recordedAt?: number|null; prompt?: string; as?: 'h1'|'h2'|'h3'; onConfirm?: (choice: 'a'|'b') => void; onUndo?: () => void; onNext?: (choice: 'a'|'b') => void; nextLabel?: string; onCommit?: (choice: 'a'|'b') => void; undoSeconds?: number; showConfirm?: boolean; toast?: string; toastId?: string|number; orderA?: string; orderB?: string }
export interface JudgeShellProps { ground?: boolean; unsent?: { n: number; onRetry?: () => void }|null; timer?: React.ReactNode; right?: React.ReactNode; footer?: React.ReactNode; toast?: string; toastId?: string|number; toastTone?: ToastProps['tone']; offline?: boolean; queued?: number; recording?: { elapsed: number; paused?: boolean; memo?: boolean; onShow?: () => void }|null; screenKey?: string; announce?: string; style?: React.CSSProperties; children?: React.ReactNode }
/** What a Sheet hands its children and actions: close(then) plays the exit, then calls then; closing() is true once a way out (a button, Escape, the scrim, a drag) has started. */
export interface SheetClose { (then?: () => void): void; closing(): boolean }
export interface SheetProps { title: React.ReactNode; titleId?: string; lede?: React.ReactNode; onClose: () => void; initialFocus?: () => HTMLElement|null|undefined; className?: string; children?: React.ReactNode | ((close: SheetClose) => React.ReactNode); actions?: React.ReactNode | ((close: SheetClose) => React.ReactNode) }
export type SkipReason = 'absent'|'busy'|'cant-find'|'conflict'|'other';
export interface SkipSheetProps { project?: string; defaultReason?: SkipReason; onSkip?: (reason: SkipReason, note: string) => void; onCancel: () => void; exclude?: SkipReason[]; excludeNote?: string }
export interface InlineConfirmProps { text?: React.ReactNode; children?: React.ReactNode; field?: React.ReactNode; confirmDisabled?: boolean; confirmLabel?: string; cancelLabel?: string; onConfirm?: () => void; onCancel?: () => void; tone?: 'danger'|'neutral'; size?: 'sm'|'md'|'lg'; className?: string; autoFocus?: boolean; returnFocus?: () => HTMLElement|null|undefined }
/** Admissions console only. Judges never score (AGENTS.md terms). */
export interface ScoreBarProps { value?: number|null; defaultValue?: number; onChange?: (n: number) => void; disabled?: boolean; lockedReason?: string; label?: string|false; ariaLabel?: string }
export interface StatusBadgeProps { status: 'In Review'|'Scored'|'Admitted'|'Admitted + Reimbursements'|'Waitlisted'|'Rejected' }
/** Every tab sets aria-controls to `panelPrefix` (default "gv-panel-") + its id; render the panel with that id. */
export interface TabsProps { items: { id: string; label: string; count?: number; tone?: 'neutral'|'danger'; locked?: boolean; icon?: IconName }[]; value?: string; defaultValue?: string; onChange?: (id: string, how: { keyboard: boolean }) => void; label?: string; panelPrefix?: string }
export interface Applicant { id: string|number; name: string; school: string; assignee: string|null; score: number|null; status: StatusBadgeProps['status'] }
export interface AdmissionsTableProps { rows: Applicant[]; role: 'admin'|'staff'; me?: string; reviewers?: string[]; total?: number; range?: string; onAssign?: (ids: Applicant['id'][], reviewer: string|null) => void; onOpen?: (row: Applicant) => void; hrefFor?: (row: Applicant) => string; selected?: Applicant['id'][]; defaultSelected?: Applicant['id'][]; onSelectionChange?: (ids: Applicant['id'][]) => void; onPrev?: () => void; onNext?: () => void; emptyTitle?: string; emptyBody?: string; emptyIcon?: string }
export interface FlagCardProps { name: string; path: Path; table: number|string; room: string; flags: { kind: 'late'|'unregistered'|'path'|'size'|'duplicate'; detail?: string }[]; onClear?: () => void; onEscalate?: () => void; clearLabel?: string; readOnly?: boolean; busy?: 'clear'|'escalate'|false; /** changes whenever the list of cards does: both buttons ignore pointer taps for dur-settle after it changes */ settleKey?: string|number }
export interface CoverageMeterProps { rooms: { room: string; total: number; twice: number; once: number }[]; unjudged?: string[] }
export interface StatTileProps { label: string; value: React.ReactNode; sub?: string }
export interface DeliberationBoardProps { onReorder?: (list: DeliberationBoardProps['nominees']) => void; nominees: { id?: string|number; name: string; path: Path; table: number|string; nominations: number; href?: string }[]; top?: number; emptyTitle?: string; emptyBody?: string }
export type PropName = 'wagon'|'horseshoe'|'cactus-tall'|'cactus-round'|'cactus-bushes'|'neon-board';
export interface EmptyStateProps { title: string; icon?: IconName; prop?: PropName; body?: string; action?: React.ReactNode; as?: 'h1'|'h2'|'h3'|'h4' }
/** The 2027 marks (assets/brand). White: `lockup`, `h-mark` (wood, ground-deep, the painted ground; never paper). Black: `longhorn`, `longhorn-alt` (paper). */
export interface BrandProps { name?: 'lockup'|'h-mark'|'longhorn'|'longhorn-alt'; alt?: string; decorative?: boolean; lazy?: boolean; className?: string }
export interface GarlandProps { tone?: 'ground'|'paper'; className?: string }
export interface PropProps { name: PropName; small?: boolean; wide?: boolean; className?: string }
export interface TableProgressProps { done: number; total: number; current?: boolean; label?: string; tone?: 'paper'|'plaque'; className?: string }
export interface OfflineBannerProps { queued?: number; compact?: boolean; children?: React.ReactNode }
export interface EnRouteProps { table: string; room: string; label?: string; hint?: string; project: { name: string; team?: string|string[] }; lost?: boolean; onMap?: (e: React.MouseEvent) => void; mapHref?: string; mapLabel?: string; onAskStaff?: () => void; lostHint?: string; children?: React.ReactNode }
export type TableCheckState = 'idle'|'scanning'|'checking'|'matched'|'mismatch'|'needs-check'|'not-found'|'offline'|'name'|'locked'|'no-camera'|'failed';
export interface TableCheckInput { method: 'code'|'qr'; code: string|null; check?: string; k?: string; raw: string }
export interface ArriveRequest { visitId: string; judgeId: string; code: string|null; method: 'scan'|'typed'|'name'; check?: string; k?: string; clientId?: string; createdAt?: number; replay?: boolean }
export interface ArriveResult { status: 'matched'|'name'|'mismatch'|'needs-check'|'locked'|'not-found'; error?: 'WrongTable'|'UnknownTable'|'CheckRequired'|'BadCheck'|'BadToken'|'TooManyTries'|'OfflineTooOld'; via?: 'scan'|'typed'|'name'; code?: string; name?: string|null; room?: string; message?: string; triesLeft?: number; at?: number }
export interface PlacardRecord { code: string; letter: string; check: string; room: string; color: string; where: string; k: string; url: string; project: string }
export interface TableCheckResult { status: TableCheckState; code?: string; name?: string|null; direction?: string; offline?: boolean; message?: string; via?: 'qr'|'scan'|'code'|'typed'; triesLeft?: number; proof?: { method: 'scan'|'typed'|'name'; code: string; check?: string; k?: string; cid?: string; at: number } }
export interface TableCheckProps { project: { name: string; table: string; team?: string|string[] }; room: string; state?: TableCheckState; result?: TableCheckResult|null; verify?: (input: TableCheckInput) => TableCheckResult|Promise<TableCheckResult>; value?: string; defaultValue?: string; onChange?: (raw: string) => void; via?: 'qr'|'scan'|'code'|'typed'; triesLeft?: number; onCheck?: (input: TableCheckInput) => void; onScan?: () => void; onCancelScan?: () => void; scanPreview?: React.ReactNode; onRetry?: () => void; onName?: () => void; onMap?: () => void }
export interface TablePlacardProps { code: string; check: string; label?: string; room?: string; roomName?: string; letter?: string; color?: string; k?: string; url?: string; project?: string; notice?: string; where?: string; scale?: number }
export interface PlacardSheetProps { tables: TablePlacardProps[]; title?: string; onClose?: () => void; onPrint?: () => void; controls?: React.ReactNode; printNames?: boolean; inline?: boolean }
export interface SwitchProps { label: React.ReactNode; checked?: boolean; defaultChecked?: boolean; onChange?: (on: boolean) => void; description?: React.ReactNode; disabled?: boolean; lockedReason?: string; onLabel?: string; offLabel?: string; className?: string }
export type DemoStatusValue = 'ran_live'|'partly_ran'|'not_shown'|'did_not_run';
export interface DemoStatusProps { value?: DemoStatusValue|null; defaultValue?: DemoStatusValue; onChange?: (v: DemoStatusValue) => void; suggested?: DemoStatusValue|'unclear'|null; disabled?: boolean; lockedReason?: string; label?: string }
export interface RecallBlockProps { rows: Recall; compact?: boolean }
export type HighlightKind = 'does'|'how'|'demo'|'standout'|'question'|'concern';
export interface Highlight { id: string; kind: HighlightKind; segment?: string|null; text: string; quote: string|null; at: number|null; certainty: 'heard'|'unsure'; marked?: boolean; state: 'suggested'|'kept'|'edited'|'removed'; demoStatus?: DemoStatusValue|'unclear'; concernKind?: 'open_question'|'limitation'|'didnt_work'|'prior_work'|'other'; source?: 'transcript' }
export interface PrizeSuggestion { prize: 'Best UI/UX'|'Most Creative'|'Best Social Impact'|'Most Useless'; quote: string; at: number|null; reason?: string; state: 'suggested'|'accepted'|'dismissed' }
export interface HighlightListProps { items?: Highlight[]; defaultItems?: Highlight[]; onKeep?: (id: string) => void; onEdit?: (id: string, text: string) => void; onRemove?: (id: string) => void; onRestore?: (id: string) => void; onKeepAll?: () => void; prize?: PrizeSuggestion|null; onNominate?: (prize: string) => void; onDismissPrize?: (prize: string) => void; fallback?: string|null; lowAudio?: boolean; readOnly?: boolean }
export interface ConsentSheetProps { onConsent?: () => void; onDecline?: () => void; onCancel: () => void; onClosed?: () => void; ai?: boolean; script?: string; title?: string }
export interface LevelMeterProps { level: number; paused?: boolean; still?: boolean }
export type TableTalkState = 'idle'|'consent'|'starting'|'recording'|'paused'|'processing'|'ready'|'declined'|'retry'|'used-up'|'memo'|'unsupported'|'denied'|'mic-busy'|'offline-queued'|'too-noisy'|'failed'|'locked-by-admin';
/** What `GavIL.talk.eligibility()` answers: the event switch, the team's opt-out and the judge's browser, each with the reason and the next step the card shows. */
export interface TalkEligibility { allowed: boolean; lock: 'event'|'team'|'browser'|null; reason: string|null; sub: string|null }
export interface TableTalkProps { state: TableTalkState; mode?: 'table'|'memo'; as?: 'h2'|'h3'; project?: string; elapsed?: number; level?: number; marks?: number[]; warn?: boolean; demo?: boolean; pausedReason?: 'user'|'screen'|'interrupted'; eligibility?: TalkEligibility; supported?: boolean; attemptsUsed?: number; maxAttempts?: number; meta?: string; highlights?: HighlightListProps; disabled?: boolean; lockedReason?: string; lockedSub?: string; failedAt?: 'start'|null; ai?: boolean; onAsk?: () => void; onConsent?: () => void; onDecline?: () => void; onCancelConsent?: () => void; onCancelStart?: () => void; onMark?: () => void; onPause?: () => void; onResume?: () => void; onStop?: () => void; onStopDelete?: () => void; onRetry?: () => void; onStart?: () => void; onDiscard?: () => void }
export interface TalkSegment { id: string; t: number; text: string; confidence?: number }
/** `starting` = waiting for the microphone (nothing records yet); `listening` = recording. A pause releases the microphone for good; resume() asks for a fresh stream, so call start() and resume() from a tap. */
export interface TalkEngine { kind: 'fixture'|'mic'; supported(): boolean; start(): void; pause(reason?: 'user'|'screen'|'interrupted'): void; resume(): void; stop(): void; discard(): void; audio?(): Blob|null; elapsed(): number; onSegment(cb: (s: TalkSegment) => void): () => void; onState(cb: (state: 'starting'|'listening'|'paused'|'ended'|'error', detail?: { reason?: string; stage?: 'start'; bytes?: number; seconds?: number }) => void): () => void; onLevel(cb: (level: number, at: number) => void): () => void }
export interface TalkFixture { mode: 'table'|'memo'; project: { id: string; name: string; tagline: string; tracks: string[]; team: string[] }; marks: number[]; judgeNotes: string; segments: TalkSegment[] }
export declare function Button(props: ButtonProps): React.ReactElement;
export declare function Badge(props: BadgeProps): React.ReactElement;
export declare function PathBadge(props: PathBadgeProps): React.ReactElement;
export declare function Icon(props: IconProps): React.ReactElement;
export declare function ToggleChip(props: ToggleChipProps): React.ReactElement;
export declare function ChoiceChips(props: ChoiceChipsProps): React.ReactElement;
export declare function NominationPicker(props: NominationPickerProps): React.ReactElement;
export declare function Card(props: CardProps): React.ReactElement;
export declare function TimerBar(props: TimerBarProps): React.ReactElement;
export declare function Wayfinding(props: WayfindingProps): React.ReactElement;
export declare function ProjectHeader(props: ProjectHeaderProps): React.ReactElement;
export declare function ProjectSkeleton(props: ProjectSkeletonProps): React.ReactElement;
export declare function Disclosure(props: DisclosureProps): React.ReactElement;
export declare function NotesField(props: NotesFieldProps): React.ReactElement;
export declare function ActionBar(props: ActionBarProps): React.ReactElement;
export declare function Toast(props: ToastProps): React.ReactElement;
export declare function CompareCard(props: CompareCardProps): React.ReactElement;
export declare function ComparePair(props: ComparePairProps): React.ReactElement;
export declare function JudgeShell(props: JudgeShellProps): React.ReactElement;
export declare function Sheet(props: SheetProps): React.ReactElement;
export declare function SkipSheet(props: SkipSheetProps): React.ReactElement;
export declare function InlineConfirm(props: InlineConfirmProps): React.ReactElement;
export declare function ScoreBar(props: ScoreBarProps): React.ReactElement;
export declare function StatusBadge(props: StatusBadgeProps): React.ReactElement;
export declare function Tabs(props: TabsProps): React.ReactElement;
export declare function AdmissionsTable(props: AdmissionsTableProps): React.ReactElement;
export declare function FlagCard(props: FlagCardProps): React.ReactElement;
export declare function CoverageMeter(props: CoverageMeterProps): React.ReactElement;
export declare function StatTile(props: StatTileProps): React.ReactElement;
export declare function DeliberationBoard(props: DeliberationBoardProps): React.ReactElement;
export declare function OfflineBanner(props: OfflineBannerProps): React.ReactElement;
export declare function EmptyState(props: EmptyStateProps): React.ReactElement;
export declare function Brand(props: BrandProps): React.ReactElement;
export declare function Garland(props: GarlandProps): React.ReactElement;
export declare function Prop(props: PropProps): React.ReactElement;
export declare function TableProgress(props: TableProgressProps): React.ReactElement;
export declare function EnRoute(props: EnRouteProps): React.ReactElement;
export declare function TableCheck(props: TableCheckProps): React.ReactElement;
export declare function TablePlacard(props: TablePlacardProps): React.ReactElement;
export declare function PlacardSheet(props: PlacardSheetProps): React.ReactElement;
export declare function Switch(props: SwitchProps): React.ReactElement;
export declare function DemoStatus(props: DemoStatusProps): React.ReactElement;
export declare function RecallBlock(props: RecallBlockProps): React.ReactElement;
export declare function HighlightList(props: HighlightListProps): React.ReactElement;
export declare function ConsentSheet(props: ConsentSheetProps): React.ReactElement;
export declare function LevelMeter(props: LevelMeterProps): React.ReactElement;
export declare function TableTalk(props: TableTalkProps): React.ReactElement;
/** Short vibration on Android (feature-detected; off with localStorage gavil_haptics=off). iOS has no Vibration API: pair every call with a visual cue. */
export declare function haptic(kind: HapticKind | number | number[]): void;
/** Screen change: runs `update` inside a View Transition when supported and motion is on, else immediately (JudgeShell's CSS rise-in plays). */
export declare function swap(update: () => void): void;
/** False under prefers-reduced-motion or :root[data-motion="reduce"] (reads the --motion token). */
export declare function motionOK(): boolean;
/** A motion token in ms, read from tokens.css (e.g. tokenMs('dur-undo')), so JS timing follows the tokens. */
export declare function tokenMs(name: string, fallback?: number): number;
/** After an action that removes the focused control (a cleared card, a bar that closes), focus `target()` once the update has rendered, if focus fell to <body>. */
export declare function keepFocus(target: () => HTMLElement|null|undefined): void;
/** Lays a clear shield over the page for dur-exit + dur-settle that swallows taps (no click, no focus change); Sheet calls it as it starts to close. Pass the pressed button's rect (`spot`) and that footprint stays shielded until dur-retap, for a button that sat over a control of the page. Use it for any overlay that closes under the thumb. */
export declare function tapShield(spot?: { left: number; top: number; width: number; height: number } | null): void;
/** Reads a typed or scanned placard code: 'A12K7', 'a12 · k7', 'A1', or a placard URL (.../t/A12?k=...). A typed Z reads as 2. */
export declare function parseTableCode(input: string): { code: string|null; check?: string; k?: string; raw?: string };
/** The placard QR payload: https://judging.hackillinois.org/t/<CODE>?k=<signed token>. It encodes the table, never the project. */
export declare function placardUrl(code: string, k?: string): string;
/** The brand art behind a token (`--art-<name>`): its url (resolved against the page) and its natural pixel size, or null when the token is missing. Hosts override the token, not this. */
export declare function art(name: string): { src: string; width: number; height: number } | null;
/** After the first screen, fetches (when the phone is idle) the small art a later screen needs: the stars, the waiting wagon, the Round 1 props (about 90 KB), so a screen reached after the connection drops still shows them. Pass token names to warm others. */
export declare function prefetchArt(names?: string[]): void;
/** Recall rows from kept highlights, the judge's demo tap and the first line of typed notes; null when there is nothing. */
export declare function recallOf(o: { highlights?: Highlight[]; demoStatus?: DemoStatusValue|null; notes?: string }): Recall|null;
/** A typed check's misreading hint, or null: "Checks never use O, 0, I, 1 or L" and "Checks never use S, 5, G, 6, B, 8 or Q" (every look-alike), or a nudge when the check is not 2 characters. A hint never costs a try. */
export declare function checkHint(check: string): string|null;
/** PREVIEWS ONLY: a stand-in for adonix's judge routes (arrive, sync, the Table talk policy). Demo data and nothing else: four made-up checks and a made-up QR token, no secret, key, digest or alphabet, and no route that lists or issues a placard. A real app calls its server instead. */
export declare const mockServer: { POLICY_KEY: string; demoToken(code: string): string; policy(): { eventEnabled: boolean; optedOut: string[] }; lease(visitId: string, code: string): void; arrive(req: ArriveRequest): Promise<ArriveResult>; sync(item: { key: string; idem?: string; kind?: string }): Promise<{ ok: true; key: string; duplicate: boolean }>; failNext(n?: number): void; arrivalsOf(visitId: string): { by: string|null; arrivals: { by: string; at: number }[]; wrongCodes: number; tries: number }|null; received(): string[]; reset(): void };
/** The label a highlight row shows ("How it works", "Limitation", "Demo · Ran live"…). */
export declare function highlightLabel(item: Highlight): string;
/** A QR code as SVG (qrcode-generator 1.4.4); renders `fallback` when the library is missing. */
export declare function QR(props: { value: string; label?: string; className?: string; fallback?: React.ReactNode }): React.ReactElement|null;
/** Table talk: the deterministic rule extractor, the server validator (reference), the engines and the sample conversations. */
export declare const talk: { extract(input: TalkFixture & { mode?: 'table'|'memo' }): any; validate(raw: any, fx: TalkFixture): { out: any; dropped: string[] }; toItems(highlights: any): Highlight[]; fallbackOf(highlights: any): string|null; copy(o?: { ai?: boolean }): { ai: boolean; script: string; notice: string; retention: string; sends: [string, string][] }; eligibility(p?: { eventEnabled?: boolean; projectOptedOut?: boolean; judgeSupported?: boolean; mode?: 'table'|'memo' }): TalkEligibility; RETENTION: string; DEMO_NOTE: string; isBanned(text?: string|null): boolean; BANNED: RegExp; INJECTION: RegExp; CONCERN_LABEL: Record<string, string>; FixtureEngine(o: { fixture: TalkFixture; rate?: number|'instant'; startDelay?: number; fail?: string; unsupported?: boolean }): TalkEngine; MicEngine(o?: { lang?: string }): TalkEngine; FIXTURES: Record<string, TalkFixture>; MEMO_FIXTURES: Record<string, TalkFixture>; memoFor(project: TalkFixture['project']): TalkFixture; mmss(seconds: number): string; stats: { starts: number } };
declare global { interface Window { GavIL: { Button: typeof Button; Badge: typeof Badge; PathBadge: typeof PathBadge; Icon: typeof Icon; ToggleChip: typeof ToggleChip; ChoiceChips: typeof ChoiceChips; NominationPicker: typeof NominationPicker; Card: typeof Card; TimerBar: typeof TimerBar; Wayfinding: typeof Wayfinding; ProjectHeader: typeof ProjectHeader; ProjectSkeleton: typeof ProjectSkeleton; Disclosure: typeof Disclosure; NotesField: typeof NotesField; ActionBar: typeof ActionBar; Toast: typeof Toast; CompareCard: typeof CompareCard; ComparePair: typeof ComparePair; JudgeShell: typeof JudgeShell; Sheet: typeof Sheet; SkipSheet: typeof SkipSheet; InlineConfirm: typeof InlineConfirm; ScoreBar: typeof ScoreBar; StatusBadge: typeof StatusBadge; Tabs: typeof Tabs; AdmissionsTable: typeof AdmissionsTable; FlagCard: typeof FlagCard; CoverageMeter: typeof CoverageMeter; StatTile: typeof StatTile; DeliberationBoard: typeof DeliberationBoard; OfflineBanner: typeof OfflineBanner; EmptyState: typeof EmptyState; Brand: typeof Brand; Garland: typeof Garland; Prop: typeof Prop; TableProgress: typeof TableProgress; EnRoute: typeof EnRoute; TableCheck: typeof TableCheck; TablePlacard: typeof TablePlacard; PlacardSheet: typeof PlacardSheet; Switch: typeof Switch; DemoStatus: typeof DemoStatus; RecallBlock: typeof RecallBlock; HighlightList: typeof HighlightList; ConsentSheet: typeof ConsentSheet; LevelMeter: typeof LevelMeter; TableTalk: typeof TableTalk; formatTime(seconds: number, hours?: boolean): string; haptic: typeof haptic; swap: typeof swap; motionOK: typeof motionOK; tokenMs: typeof tokenMs; keepFocus: typeof keepFocus; tapShield: typeof tapShield; parseTableCode: typeof parseTableCode; placardUrl: typeof placardUrl; art: typeof art; prefetchArt: typeof prefetchArt; recallOf: typeof recallOf; QR: typeof QR; talk: typeof talk; checkHint: typeof checkHint; mockServer: typeof mockServer; highlightLabel: typeof highlightLabel } } }
