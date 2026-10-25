/**
 * The canonical HackIllinois 2027 demo and test dataset. The JudgePrototype in design-system/
 * uses the same names, table codes and judges, so demos, screenshots and tests match.
 *
 *   Room 4217 (A, Pro)      Room 4218 (B, Pro)      Room 4219 (C, General)   Room 1404 (D, General)
 *   p01 NeuralMesh A12      p09 HealthBridge B03    p17 CrisisMap C05        p25 QuickCart D04
 *   p02 EcoLens    A17      p10 Lumen        B07    p18 StudyBuddy C07       p26 ParkPal   D13
 *   p03 PocketLab  A20      p11 Lumen.ai     B08    p19 FarmSense C14        p27 Replay    D15
 *   p04 Tidal      A03      p12 Vault        B12    p20 LateBloom C16        p29 Harbor    D17
 *   p05 SoundScape A09      p13 InferKit     B16    p21 Quill     C18        p30 Sprout    D20
 *   p06 LedgerLite A14      p14 Orbit        B19    p22 Canopy    C21        p31 Bento     D24
 *   p07 Mirror     A15      p15 Kiln         B22    p23 Relay     C24        p32 Loop      D28
 *   p08 Atlas      A22      p16 SixPack      B24    p24 Glean     C27        (p28 Typo D56: invalid)
 *
 * Held: p05 (late commits), p09 (path mismatch), p16 (team of 5), p27 (escalated).
 * Review only, still judged: p05 (unregistered member), p10 (repo age), p21 ("max-h").
 * Ground truth for simulations (SCENARIO): p06 absent all night, p14 busy with sponsor demos
 * for the first 15 min, p20 absent for the first 30 min.
 */
import { mulberry32 } from "../gavel"
import {
    seedTableChecks,
    tableCode,
    validateSeed,
    type SeedProject,
} from "../judging"
import type { Flag, Judge, Prize, Project, Room, TeamMember } from "./types"

export const ROOMS: Room[] = [
    {
        id: "4217",
        letter: "A",
        color: "Gold",
        path: "pro",
        building: "Siebel Center",
        floor: "4th floor",
        hint: "Siebel Center, 4th floor. Tables A01–A28.",
        tables: { from: 1, to: 28 },
    },
    {
        id: "4218",
        letter: "B",
        color: "Teal",
        path: "pro",
        building: "Siebel Center",
        floor: "4th floor",
        hint: "Siebel Center, 4th floor. Tables B01–B28.",
        tables: { from: 1, to: 28 },
    },
    {
        id: "4219",
        letter: "C",
        color: "Rose",
        path: "general",
        building: "Siebel Center",
        floor: "4th floor",
        hint: "Siebel Center, 4th floor. Tables C01–C28.",
        tables: { from: 1, to: 28 },
    },
    {
        id: "1404",
        letter: "D",
        color: "Sage",
        path: "general",
        building: "Siebel Center",
        floor: "1st floor",
        hint: "Siebel Center, 1st floor. Tables D01–D32.",
        tables: { from: 1, to: 32 },
    },
]

const hi = (
    id: string,
    name: string,
    room: string,
    paths: Prize["paths"] = ["pro", "general"],
): Prize => ({
    id,
    name,
    kind: "hackillinois",
    paths,
    room,
    nominatable: true,
    aiSuggest: true,
})

export const PRIZES: Prize[] = [
    hi("ux", "Best UI/UX", "2405"),
    hi("creative", "Most Creative", "2407"),
    hi("impact", "Best Social Impact", "2409"),
    hi("useless", "Most Useless", "2411", ["general"]),
    // An audience award: judges may nominate, Table talk never suggests it.
    { ...hi("popular", "Most Popular", "Main stage"), aiSuggest: false },
    {
        id: "stripe",
        name: "Stripe: Best Payments Hack",
        kind: "company",
        sponsor: "Stripe",
        paths: ["pro", "general"],
        room: "Stripe booth",
        nominatable: true,
        aiSuggest: true,
    },
    {
        id: "modal",
        name: "Modal: Best Use of Modal",
        kind: "company",
        sponsor: "Modal",
        paths: ["pro"],
        room: "Modal booth",
        nominatable: true,
        aiSuggest: true,
    },
    {
        id: "caterpillar",
        name: "Caterpillar: Best Industrial Hack",
        kind: "company",
        sponsor: "Caterpillar",
        paths: ["general"],
        room: "Caterpillar booth",
        nominatable: true,
        aiSuggest: true,
    },
    {
        id: "mlh-mongodb",
        name: "MLH: Best Use of MongoDB",
        kind: "mlh",
        paths: ["pro", "general"],
        room: "MLH table",
        nominatable: true,
        aiSuggest: true,
    },
    {
        id: "pro-overall",
        name: "Pro: Best Overall",
        kind: "overall",
        paths: ["pro"],
        room: "2403",
        nominatable: false,
        aiSuggest: false,
    },
    {
        id: "general-overall",
        name: "General: Best Overall",
        kind: "overall",
        paths: ["general"],
        room: "2404",
        nominatable: false,
        aiSuggest: false,
    },
]

/**
 * Registered members, with their registration email (first.last@illinois.edu): the attendee
 * app's table check-in matches the signed-in attendee to their team by it. Judges' phones never
 * get these (the mock strips team emails from every judge response).
 */
const team = (...names: string[]): TeamMember[] =>
    names.map((name) => ({
        name,
        registered: true,
        email: `${name.toLowerCase().replace(/\s+/g, ".")}@illinois.edu`,
    }))

function row(
    p: Omit<SeedProject, "devpostUrl" | "repoUrl" | "tracks" | "optIns"> & {
        slug: string
        tracks?: string[]
        optIns?: string[]
    },
): SeedProject {
    const { slug, tracks = [], optIns = [], ...rest } = p
    return {
        ...rest,
        tracks,
        optIns,
        devpostUrl: `https://devpost.com/software/${slug}`,
        repoUrl: `https://github.com/${slug}/${slug}`,
    }
}

/** Every row as imported, including p28, which the seed validator rejects (D56 > D32). */
export const SEED_PROJECTS: SeedProject[] = [
    // ── Room 4217 · A · Pro ──
    row({
        id: "p01",
        slug: "neuralmesh",
        name: "NeuralMesh",
        tableCode: "A12",
        tracks: ["Modal"],
        optIns: ["modal"],
        views: 0,
        commits: 48,
        tagline: "Self-healing P2P mesh networking with RL routing.",
        description:
            "A self-organizing peer-to-peer mesh network powered by reinforcement learning. Nodes reroute traffic around failures with zero central coordination.",
        team: team("Ana Ruiz", "Dev Patel", "Kim Lee"),
    }),
    row({
        id: "p02",
        slug: "ecolens",
        name: "EcoLens",
        tableCode: "A17",
        views: 0,
        commits: 131,
        tagline: "Carbon footprint of anything you point your camera at.",
        description:
            "Point your camera at any product to see its full supply-chain carbon footprint, powered by vision AI and a live emissions database.",
        team: team("Maya Chen", "Leo Brooks"),
    }),
    row({
        id: "p03",
        slug: "pocketlab",
        name: "PocketLab",
        tableCode: "A20",
        views: 0,
        commits: 76,
        tagline: "A $12 oscilloscope from a phone and a microcontroller.",
        description:
            "Turns a phone plus a cheap microcontroller into an oscilloscope and logic analyzer for intro EE labs.",
        team: team("Sam Ortiz", "Priya Nair", "Jo Kim", "Ben Wu"),
    }),
    row({
        id: "p04",
        slug: "tidal",
        name: "Tidal",
        tableCode: "A03",
        tracks: ["Stripe"],
        optIns: ["stripe"],
        views: 1,
        commits: 59,
        tagline: "Split rent and bills with automatic settle-up.",
        description:
            "Roommates connect a card once; Tidal splits recurring bills and settles balances monthly through Stripe.",
        team: [
            { name: "Chris Lee", registered: true },
            // Interns at Stripe: every Stripe judge has an automatic conflict.
            { name: "Dana Fox", registered: true, email: "dana@stripe.com" },
        ],
    }),
    row({
        id: "p05",
        slug: "soundscape",
        name: "SoundScape",
        tableCode: "A09",
        views: 0,
        commits: 33,
        tagline: "Generative ambient soundtracks for any room.",
        description:
            "Listens to a room for ten seconds and composes a matching ambient soundtrack that adapts as people come and go.",
        team: [
            ...team("Rae Park", "Omar Haddad"),
            { name: "devin_k", registered: false },
        ],
    }),
    row({
        id: "p06",
        slug: "ledgerlite",
        name: "LedgerLite",
        tableCode: "A14",
        tracks: ["Stripe"],
        optIns: ["stripe"],
        views: 0,
        commits: 41,
        tagline: "Bookkeeping for student orgs in one shared ledger.",
        description:
            "Student orgs log dues and reimbursements in one shared ledger with Stripe payouts and a treasurer handoff report.",
        team: team("Noor Ali", "Sam Reyes"),
    }),
    row({
        id: "p07",
        slug: "mirror",
        name: "Mirror",
        tableCode: "A15",
        views: 1,
        commits: 67,
        tagline: "A smart mirror that coaches your posture.",
        description:
            "A two-way mirror and a webcam track posture while you work and nudge you with a quiet light when you slump.",
        team: [
            { name: "Ivy Chen", registered: true },
            // A Stripe intern on a non-Stripe project: an automatic conflict for Stripe judges,
            // which is why Sarah's Round 1 queue is the prototype's four tables.
            { name: "Raj Mehta", registered: true, email: "raj@stripe.com" },
        ],
    }),
    row({
        id: "p08",
        slug: "atlas",
        name: "Atlas",
        tableCode: "A22",
        views: 0,
        commits: 95,
        tagline: "Indoor maps from a 30-second phone walkthrough.",
        description:
            "Walk a building with your phone for 30 seconds and Atlas builds a navigable indoor map with room labels.",
        team: team("Theo Grant", "Lia Novak", "Max Ortiz"),
    }),
    // ── Room 4218 · B · Pro ──
    row({
        id: "p09",
        slug: "healthbridge",
        name: "HealthBridge",
        tableCode: "B03",
        views: 0,
        commits: 64,
        tagline: "Clinic intake forms in 40 languages.",
        description:
            "Patients fill intake forms in their own language; clinics receive them translated and structured.",
        team: team("Ines Duarte", "Kofi Mensah", "Lu Wang", "Ravi Iyer"),
    }),
    row({
        id: "p10",
        slug: "lumen",
        name: "Lumen",
        tableCode: "B07",
        views: 3,
        commits: 102,
        tagline: "Accessible reading mode for any PDF.",
        description:
            "Reflows scanned PDFs into accessible, screen-reader-friendly text with math rendered as MathML.",
        team: team("Gus Ford", "Hira Khan"),
    }),
    row({
        id: "p11",
        slug: "lumen-ai",
        name: "Lumen.ai",
        tableCode: "B08",
        views: 0,
        commits: 58,
        tagline: "Lighting plans for small venues from one photo.",
        description:
            "Snap a photo of a stage and Lumen.ai proposes a DMX lighting plan with cue presets for small venues.",
        team: team("Pia Sol", "Ken Abe"),
    }),
    row({
        id: "p12",
        slug: "vault",
        name: "Vault",
        tableCode: "B12",
        tracks: ["Stripe"],
        optIns: ["stripe"],
        views: 1,
        commits: 83,
        tagline: "Escrow for freelance gigs between students.",
        description:
            "Clients fund a milestone into escrow; Vault releases it through Stripe Connect when both sides sign off.",
        team: team("Omar Said", "Lena Park"),
    }),
    row({
        id: "p13",
        slug: "inferkit",
        name: "InferKit",
        tableCode: "B16",
        tracks: ["Modal"],
        optIns: ["modal"],
        views: 2,
        commits: 120,
        tagline: "Serverless GPU inference behind one decorator.",
        description:
            "Wrap a Python function with one decorator and InferKit deploys it to Modal GPUs with autoscaling and a typed client.",
        team: team("Ari Cohen", "Bea Lin", "Cal Ruiz"),
    }),
    row({
        id: "p14",
        slug: "orbit",
        name: "Orbit",
        tableCode: "B19",
        views: 0,
        commits: 72,
        tagline: "Satellite pass alerts for ham radio operators.",
        description:
            "Predicts satellite passes for your location and tunes an SDR automatically when one comes overhead.",
        team: team("Nils Berg", "Ada Kim"),
    }),
    row({
        id: "p15",
        slug: "kiln",
        name: "Kiln",
        tableCode: "B22",
        views: 2,
        commits: 49,
        tagline: "Pottery firing schedules from a $10 thermocouple.",
        description:
            "Logs kiln temperature with a cheap thermocouple and adjusts the firing schedule to hit cone targets.",
        team: team("June Park", "Eli Ross"),
    }),
    row({
        id: "p16",
        slug: "sixpack",
        name: "SixPack",
        tableCode: "B24",
        views: 0,
        commits: 140,
        tagline: "Group fitness challenges with live leaderboards.",
        description:
            "Friends join a weekly fitness challenge; wearables sync and a live leaderboard keeps everyone honest.",
        team: team("Al Moore", "Bo Chen", "Cy Diaz", "Di Wu", "Ed Fox"),
    }),
    // ── Room 4219 · C · General ──
    row({
        id: "p17",
        slug: "crisismap",
        name: "CrisisMap",
        tableCode: "C05",
        views: 0,
        commits: 88,
        tagline: "Live shelter and supply map for disaster response.",
        description:
            "Crowdsourced, offline-first map of open shelters, water and power during disasters, synced over SMS.",
        team: team("Ada Byrne", "Tariq Aziz"),
    }),
    row({
        id: "p18",
        slug: "studybuddy",
        name: "StudyBuddy",
        tableCode: "C07",
        tracks: ["Stripe"],
        optIns: ["stripe"],
        views: 2,
        commits: 51,
        tagline: "Find a study partner in your lecture, right now.",
        description:
            "Matches students in the same lecture who want to study the same topic in the next hour.",
        team: team("Nina Petrov", "Jae Song", "Elle Moss"),
    }),
    row({
        id: "p19",
        slug: "farmsense",
        name: "FarmSense",
        tableCode: "C14",
        tracks: ["Caterpillar"],
        optIns: ["caterpillar"],
        views: 1,
        commits: 45,
        tagline: "Soil moisture alerts from $5 sensors.",
        description:
            "LoRa soil sensors text farmers when a field needs water, with a season-long dashboard.",
        team: team("Will Ames", "Rosa Diaz", "Tom Ng"),
    }),
    row({
        id: "p20",
        slug: "latebloom",
        name: "LateBloom",
        tableCode: "C16",
        views: 0,
        commits: 37,
        tagline: "Plant care reminders that learn your apartment.",
        description:
            "A light sensor and a watering log learn each plant's corner of your apartment and remind you before it wilts.",
        team: team("Rin Sato", "Mo Khan"),
    }),
    row({
        id: "p21",
        slug: "quill",
        name: "Quill",
        tableCode: "C18",
        views: 1,
        commits: 62,
        tagline: "Handwritten lecture notes to searchable text.",
        description:
            "Photograph handwritten notes and Quill turns them into searchable, linked text with diagrams kept as images.",
        team: [
            ...team("Ava Stone", "Ben Ito"),
            { name: "max-h", registered: false },
        ],
    }),
    row({
        id: "p22",
        slug: "canopy",
        name: "Canopy",
        tableCode: "C21",
        views: 1,
        commits: 54,
        tagline: "Street shade maps for hot-weather walking routes.",
        description:
            "Combines tree canopy and building shadows by hour to route pedestrians through the coolest streets.",
        team: team("Lea Moreau", "Sid Rao"),
    }),
    row({
        id: "p23",
        slug: "relay",
        name: "Relay",
        tableCode: "C24",
        optIns: ["mlh-mongodb"],
        views: 0,
        commits: 77,
        tagline: "Ride-share boards for campus events.",
        description:
            "Students post and claim rides to events; MongoDB change streams push matches to everyone nearby.",
        team: team("Kai Young", "Uma Das", "Leo Park"),
    }),
    row({
        id: "p24",
        slug: "glean",
        name: "Glean",
        tableCode: "C27",
        views: 2,
        commits: 69,
        tagline: "Match restaurant surplus with food banks tonight.",
        description:
            "Restaurants post surplus before closing; Glean routes volunteer drivers to the nearest food bank with room.",
        team: team("Ola Ade", "Pat Kim"),
    }),
    // ── Room 1404 · D · General ──
    row({
        id: "p25",
        slug: "quickcart",
        name: "QuickCart",
        tableCode: "D04",
        tracks: ["Stripe"],
        optIns: ["stripe"],
        views: 2,
        commits: 70,
        tagline: "Checkout for campus food trucks.",
        description:
            "Order ahead and pay at campus food trucks; trucks see a live queue on a tablet.",
        team: team("Zoe Hart", "Ian Cole"),
    }),
    row({
        id: "p26",
        slug: "parkpal",
        name: "ParkPal",
        tableCode: "D13",
        views: 1,
        commits: 39,
        tagline: "Open campus parking spots, predicted.",
        description:
            "Predicts open parking spots by lot and hour from historical permit-gate data.",
        team: team("Mia Lopez", "Ben Kraus"),
    }),
    row({
        id: "p27",
        slug: "replay",
        name: "Replay",
        tableCode: "D15",
        views: 0,
        commits: 210,
        tagline: "Instant replays for intramural games.",
        description:
            "Phones around the field record continuously; tap once to cut a synced multi-angle replay.",
        team: team("Gil Cruz", "Hana Ito"),
    }),
    row({
        id: "p28",
        slug: "typo",
        name: "Typo",
        // Invalid on purpose: Room 1404 has tables D01–D32. validateSeed rejects this row.
        tableCode: "D56",
        views: 0,
        tagline: "A row with a seating typo.",
        description: "Exists to prove the seed validator rejects bad seating.",
        team: team("Test Row"),
    }),
    row({
        id: "p29",
        slug: "harbor",
        name: "Harbor",
        tableCode: "D17",
        views: 0,
        commits: 58,
        tagline: "Book a slip at the campus boathouse.",
        description:
            "Members book kayaks and slips at the boathouse; Harbor handles waivers and the waitlist.",
        team: team("Ivo Lund", "Ama Reed"),
    }),
    row({
        id: "p30",
        slug: "sprout",
        name: "Sprout",
        tableCode: "D20",
        optIns: ["mlh-mongodb"],
        views: 0,
        commits: 66,
        tagline: "Seed swaps for community gardens.",
        description:
            "Gardeners list seeds to swap; Sprout matches by growing zone and season, stored in MongoDB Atlas.",
        team: team("Fay Lin", "Gus Hale"),
    }),
    row({
        id: "p31",
        slug: "bento",
        name: "Bento",
        tableCode: "D24",
        views: 2,
        commits: 44,
        tagline: "Meal-prep plans from what's already in your fridge.",
        description:
            "Scan your fridge shelf and Bento plans five days of lunches that use everything before it spoils.",
        team: team("Kim Vu", "Lou Hart"),
    }),
    row({
        id: "p32",
        slug: "loop",
        name: "Loop",
        tableCode: "D28",
        views: 3,
        commits: 81,
        tagline: "Return reusable cups anywhere on campus.",
        description:
            "Scan a cup into any Loop bin on campus; deposits refund instantly and bins report when they're full.",
        team: team("Ria Sen", "Tom Byrd"),
    }),
]

const SEED = validateSeed(ROOMS, SEED_PROJECTS)

/** The 31 live projects (p28 is rejected by the seed validator). */
export const PROJECTS: Project[] = SEED.projects
/** What the seed validator rejected (p28 Typo at D56). */
export const SEED_ERRORS = SEED.errors

/**
 * The 2-character check printed after each table's code ("A12 · K7"), per TABLE (not project,
 * so moving a team needs no reprint). adonix draws them with a CSPRNG at seed time; the demo
 * dataset fixes the prototype's tables and draws the rest from a seeded rng.
 */
export const CANONICAL_CHECKS: Record<string, string> = {
    A12: "K7",
    A17: "M3",
    A20: "T9",
    A22: "R4",
    A14: "W2",
}
export const TABLE_CHECKS: Record<string, string> = seedTableChecks(
    ROOMS,
    mulberry32(0x2027c0de),
    CANONICAL_CHECKS,
)

const judge = (
    j: Omit<Judge, "seen" | "conflicts" | "checkedIn"> &
        Partial<Pick<Judge, "conflicts" | "checkedIn">>,
): Judge => ({
    seen: 0,
    conflicts: [],
    checkedIn: false,
    ...j,
    ...(j.checkedIn ? { checkedInAt: "2027-02-28T17:41:00-06:00" } : {}),
})

export const JUDGES: Judge[] = [
    // The prototype's judge, checked in. Automatic conflicts: p04 Tidal and p07 Mirror (a team
    // member is at stripe.com) and p06 LedgerLite (Stripe track). Her Round 1 queue is therefore
    // exactly the prototype's: NeuralMesh A12, EcoLens A17, PocketLab A20, Atlas A22.
    judge({
        id: "j1",
        name: "Sarah Kim",
        email: "sarah.kim@stripe.com",
        kind: "sponsor",
        org: "Stripe",
        orgDomain: "stripe.com",
        path: "pro",
        room: "4217",
        round2PrizeId: "ux",
        checkedIn: true,
    }),
    judge({
        id: "j2",
        name: "Marcus Hall",
        email: "marcus.hall@example.com",
        kind: "volunteer",
        org: "Volunteer",
        path: "general",
        room: "4219",
        round2PrizeId: "creative",
        checkedIn: true,
    }),
    // Not checked in. Declared a conflict with p01 NeuralMesh, the top Modal nominee.
    judge({
        id: "j3",
        name: "Priya Shah",
        email: "priya.shah@modal.com",
        kind: "sponsor",
        org: "Modal",
        orgDomain: "modal.com",
        path: "pro",
        room: "4217",
        round2PrizeId: "modal",
        conflicts: ["p01"],
    }),
    judge({
        id: "j4",
        name: "Tom Becker",
        email: "tom.becker@cat.com",
        kind: "sponsor",
        org: "Caterpillar",
        orgDomain: "cat.com",
        path: "general",
        room: "1404",
        round2PrizeId: "caterpillar",
        checkedIn: true,
    }),
    // Not checked in.
    judge({
        id: "j5",
        name: "Lena Ortiz",
        email: "lena.ortiz@example.com",
        kind: "volunteer",
        org: "Volunteer",
        path: "general",
        room: "4219",
        round2PrizeId: "impact",
    }),
    // Moved to room 4217 mid-round in tests.
    judge({
        id: "j6",
        name: "Diego Ruiz",
        email: "diego.ruiz@example.com",
        kind: "volunteer",
        org: "Volunteer",
        path: "pro",
        room: "4218",
        round2PrizeId: "ux",
        checkedIn: true,
    }),
    // Revoked in tests.
    judge({
        id: "j7",
        name: "Ama Owusu",
        email: "ama.owusu@example.com",
        kind: "volunteer",
        org: "Volunteer",
        path: "general",
        room: "1404",
        round2PrizeId: "general-overall",
        checkedIn: true,
    }),
    judge({
        id: "j8",
        name: "Ken Ito",
        email: "ken.ito@example.com",
        kind: "volunteer",
        org: "Volunteer",
        path: "pro",
        room: "4218",
        round2PrizeId: "pro-overall",
        checkedIn: true,
    }),
]

const flag = (
    id: string,
    projectId: string,
    kind: Flag["kind"],
    confidence: Flag["confidence"],
    detail: string,
    extra: Partial<Flag> = {},
): Flag => ({
    id,
    projectId,
    kind,
    confidence,
    detail,
    status: "open",
    raisedAt: "2027-02-28T09:41:00-06:00",
    ...extra,
})

export const FLAGS: Flag[] = [
    flag(
        "f1",
        "p05",
        "late",
        "hold",
        "3 commits 40 min after the 9:00 AM deadline (README, 2 source files).",
    ),
    flag(
        "f2",
        "p05",
        "unregistered",
        "review",
        "“devin_k” on Devpost has no registration. May be a typo of a registered name.",
    ),
    flag(
        "f3",
        "p09",
        "path",
        "hold",
        "Submitted as Pro; registration shows 2 of 4 members on General.",
    ),
    flag(
        "f4",
        "p10",
        "duplicate",
        "review",
        "Repo created 3 weeks before the hackathon (first commit Feb 6).",
    ),
    flag("f5", "p16", "size", "hold", "5 members on Devpost; the limit is 4."),
    flag(
        "f6",
        "p21",
        "unregistered",
        "review",
        "“max-h” on Devpost has no registration. May be a typo of a registered name.",
    ),
    flag(
        "f7",
        "p27",
        "duplicate",
        "hold",
        "Same repo and demo as a 2026 project at another hackathon.",
        { status: "escalated", reason: "Organizers are contacting the team." },
    ),
]

/**
 * Seeded nominations from judges outside this demo, so Round 2 boards are not empty. Only
 * HackIllinois prizes use nominations to pick finalists; company and MLH boards are opt-ins.
 */
export const BASE_NOMINATIONS: Record<string, Record<string, number>> = {
    ux: { p02: 9, p01: 7, p03: 6, p17: 5, p22: 4, p10: 3, p13: 2, p26: 2 },
    creative: { p01: 5, p19: 4, p23: 3, p07: 2, p15: 2, p31: 1 },
    impact: { p17: 8, p24: 6, p22: 5, p02: 4, p30: 3 },
    useless: { p26: 3, p32: 2, p31: 1 },
    popular: { p02: 4, p18: 3 },
}

/**
 * Ground truth the queue never sees, for simulations and demos: whether the team is really
 * at the table at a given minute after Round 1 starts.
 */
export const SCENARIO = {
    /** Absent all night: two reports auto-hold it. */
    absentAllNight: ["p06"],
    /** Absent until this many minutes in, then present. */
    absentUntilMinute: { p20: 30 } as Record<string, number>,
    /** Presenting to sponsor judges until this many minutes in. */
    busyUntilMinute: { p14: 15 } as Record<string, number>,
}

/** "A12" -> the project at that table. */
export function projectAt(code: string): Project | undefined {
    return PROJECTS.find((p) => p.tableCode === code)
}

export { tableCode }
