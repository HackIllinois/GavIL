import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";

interface Props {
  room: string;
  onClose: () => void;
}

type MapTab = "floor" | "tables";

// Table numbers assigned per room (mock layout)
const ROOM_TABLES: Record<string, number[]> = {
  "4217": [11, 17, 29, 38, 42, 55],
  "4218": [3,  8,  14, 22, 31, 47],
  "4219": [5,  12, 19, 27, 36, 48],
  "4220": [7,  15, 23, 33, 44, 52],
};

const BLUEPRINT_BG     = "#08152a";
const BLUEPRINT_GRID   = "#1a3a6a";
const BLUEPRINT_WALL   = "#3a7bd5";
const BLUEPRINT_ROOM   = "#0d1e38";
const BLUEPRINT_TEXT   = "#8ab4f8";
const BLUEPRINT_DIM    = "#5a9fff";
const HIGHLIGHT_FILL   = "#2a0f04";
const HIGHLIGHT_STROKE = "#e96b2a";
const TABLE_FILL       = "#0f2a42";
const TABLE_STROKE     = "#3a7bd5";

function BlueprintGrid({ w, h }: { w: number; h: number }) {
  const cols: number[] = [];
  const rows: number[] = [];
  for (let x = 0; x <= w; x += 20) cols.push(x);
  for (let y = 0; y <= h; y += 20) rows.push(y);
  return (
    <g stroke={BLUEPRINT_GRID} strokeWidth={0.4} opacity={0.5}>
      {cols.map((x) => <line key={`c${x}`} x1={x} y1={0} x2={x} y2={h} />)}
      {rows.map((y) => <line key={`r${y}`} x1={0} y1={y} x2={w} y2={y} />)}
    </g>
  );
}

function FloorPlanSVG({ highlightRoom }: { highlightRoom: string }) {
  const W = 380;
  const H = 280;

  // Room definitions: id, x, y, w, h
  const rooms = [
    { id: "4217", x: 28,  y: 28,  w: 140, h: 90 },
    { id: "4218", x: 182, y: 28,  w: 110, h: 90 },
    { id: "4219", x: 28,  y: 162, w: 140, h: 90 },
    { id: "4220", x: 182, y: 162, w: 110, h: 90 },
  ];

  const utilX = 304;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      style={{ background: BLUEPRINT_BG }}
      aria-label="Floor plan"
    >
      <BlueprintGrid w={W} h={H} />

      {/* Building outer wall */}
      <rect x={20} y={20} width={W - 40} height={H - 40}
        fill="none" stroke={BLUEPRINT_WALL} strokeWidth={1.5} />

      {/* Hallway band */}
      <rect x={20} y={124} width={W - 40} height={32}
        fill="#0b1d35" stroke={BLUEPRINT_WALL} strokeWidth={1} />
      <text x={W / 2} y={144} textAnchor="middle" fill={BLUEPRINT_DIM}
        fontSize={8} fontFamily="monospace" letterSpacing={2}>
        CORRIDOR
      </text>

      {/* Competition rooms */}
      {rooms.map((r) => {
        const active = r.id === highlightRoom;
        return (
          <g key={r.id}>
            <rect
              x={r.x} y={r.y} width={r.w} height={r.h}
              fill={active ? HIGHLIGHT_FILL : BLUEPRINT_ROOM}
              stroke={active ? HIGHLIGHT_STROKE : BLUEPRINT_WALL}
              strokeWidth={active ? 2 : 1}
            />
            {/* Room label */}
            <text
              x={r.x + r.w / 2} y={r.y + r.h / 2 - 6}
              textAnchor="middle" fill={active ? "#e96b2a" : BLUEPRINT_TEXT}
              fontSize={13} fontFamily="monospace" fontWeight="bold"
            >
              {r.id}
            </text>
            {active && (
              <text
                x={r.x + r.w / 2} y={r.y + r.h / 2 + 12}
                textAnchor="middle" fill="#e96b2a"
                fontSize={7.5} fontFamily="monospace" letterSpacing={1}
              >
                ← YOU ARE HERE
              </text>
            )}
          </g>
        );
      })}

      {/* Utility block — top right (stairs + elevator) */}
      <rect x={utilX} y={28} width={56} height={90}
        fill={BLUEPRINT_ROOM} stroke={BLUEPRINT_WALL} strokeWidth={1} />
      {/* Stairs symbol (diagonal lines) */}
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i}
          x1={utilX + 4 + i * 10} y1={28 + 4}
          x2={utilX + 4}           y2={28 + 4 + i * 10}
          stroke={BLUEPRINT_DIM} strokeWidth={0.8}
        />
      ))}
      <text x={utilX + 28} y={108} textAnchor="middle"
        fill={BLUEPRINT_TEXT} fontSize={7} fontFamily="monospace" letterSpacing={1}>
        STAIRS
      </text>

      {/* Utility block — bottom right (bathrooms) */}
      <rect x={utilX} y={162} width={56} height={90}
        fill={BLUEPRINT_ROOM} stroke={BLUEPRINT_WALL} strokeWidth={1} />
      {/* Bathroom symbol — circle */}
      <circle cx={utilX + 28} cy={207} r={14}
        fill="none" stroke={BLUEPRINT_DIM} strokeWidth={0.8} />
      <circle cx={utilX + 28} cy={207} r={5}
        fill="none" stroke={BLUEPRINT_DIM} strokeWidth={0.8} />
      <text x={utilX + 28} y={242} textAnchor="middle"
        fill={BLUEPRINT_TEXT} fontSize={7} fontFamily="monospace" letterSpacing={1}>
        WC / ELEV
      </text>

      {/* North label */}
      <text x={W - 24} y={30} textAnchor="end"
        fill={BLUEPRINT_DIM} fontSize={8} fontFamily="monospace">
        N ↑
      </text>

      {/* Scale bar */}
      <line x1={28} y1={H - 22} x2={68} y2={H - 22}
        stroke={BLUEPRINT_DIM} strokeWidth={1} />
      <line x1={28} y1={H - 18} x2={28} y2={H - 26}
        stroke={BLUEPRINT_DIM} strokeWidth={1} />
      <line x1={68} y1={H - 18} x2={68} y2={H - 26}
        stroke={BLUEPRINT_DIM} strokeWidth={1} />
      <text x={48} y={H - 8} textAnchor="middle"
        fill={BLUEPRINT_DIM} fontSize={7} fontFamily="monospace">
        10m
      </text>
    </svg>
  );
}

function TableLayoutSVG({ room }: { room: string }) {
  const W = 320;
  const H = 240;

  const tables = ROOM_TABLES[room] ?? ROOM_TABLES["4217"];
  // Arrange tables in a 2-row grid
  const cols = 3;
  const tableW = 64;
  const tableH = 36;
  const colGap = (W - 56 - cols * tableW) / (cols - 1);
  const rowStartY = 70;
  const rowGap = 50;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      style={{ background: BLUEPRINT_BG }}
      aria-label="Table layout"
    >
      <BlueprintGrid w={W} h={H} />

      {/* Room outline */}
      <rect x={20} y={20} width={W - 40} height={H - 40}
        fill={BLUEPRINT_ROOM} stroke={BLUEPRINT_WALL} strokeWidth={1.5} />

      {/* Projector / screen wall at top */}
      <rect x={80} y={26} width={160} height={6}
        fill={BLUEPRINT_DIM} stroke={BLUEPRINT_DIM} strokeWidth={0.5} />
      <text x={W / 2} y={46} textAnchor="middle"
        fill={BLUEPRINT_TEXT} fontSize={7.5} fontFamily="monospace" letterSpacing={2}>
        SCREEN / PRESENTER AREA
      </text>

      {/* Entrance at bottom */}
      <rect x={120} y={H - 26} width={80} height={8}
        fill={BLUEPRINT_BG} stroke={BLUEPRINT_BG} strokeWidth={1} />
      <line x1={120} y1={H - 20} x2={120} y2={H - 28}
        stroke={BLUEPRINT_WALL} strokeWidth={1.5} />
      <line x1={200} y1={H - 20} x2={200} y2={H - 28}
        stroke={BLUEPRINT_WALL} strokeWidth={1.5} />
      {/* Door arc */}
      <path d={`M 120 ${H - 20} A 40 40 0 0 1 160 ${H - 60}`}
        fill="none" stroke={BLUEPRINT_DIM} strokeWidth={0.8} strokeDasharray="2,2" />
      <text x={W / 2} y={H - 8} textAnchor="middle"
        fill={BLUEPRINT_DIM} fontSize={7.5} fontFamily="monospace" letterSpacing={2}>
        ENTRANCE
      </text>

      {/* Tables */}
      {tables.map((tableNum, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = 28 + col * (tableW + colGap);
        const y = rowStartY + row * (tableH + rowGap);
        return (
          <g key={tableNum}>
            <rect
              x={x} y={y} width={tableW} height={tableH}
              fill={TABLE_FILL} stroke={TABLE_STROKE} strokeWidth={1}
              rx={2}
            />
            {/* Table number */}
            <text
              x={x + tableW / 2} y={y + tableH / 2 + 5}
              textAnchor="middle" fill={BLUEPRINT_TEXT}
              fontSize={14} fontFamily="monospace" fontWeight="bold"
            >
              {tableNum}
            </text>
            {/* Chairs — small dots on long edges */}
            {[0.25, 0.75].map((t) => (
              <g key={t}>
                <rect x={x + tableW * t - 5} y={y - 6} width={10} height={5}
                  fill="none" stroke={BLUEPRINT_DIM} strokeWidth={0.7} rx={1} />
                <rect x={x + tableW * t - 5} y={y + tableH + 1} width={10} height={5}
                  fill="none" stroke={BLUEPRINT_DIM} strokeWidth={0.7} rx={1} />
              </g>
            ))}
          </g>
        );
      })}

      {/* Room label */}
      <text x={W - 26} y={32} textAnchor="end"
        fill="#e96b2a" fontSize={10} fontFamily="monospace" fontWeight="bold">
        {room}
      </text>
    </svg>
  );
}

export function RoomMapModal({ room, onClose }: Props) {
  const [tab, setTab] = useState<MapTab>("floor");

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg bg-[#08152a] border border-[#3a7bd5]/40 rounded-2xl overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#3a7bd5]/20">
            <div>
              <p className="text-white text-sm" style={{ fontWeight: 600 }}>
                Room {room}
              </p>
              <p className="text-[#8ab4f8] text-xs mt-0.5">Venue maps</p>
            </div>
            <button
              onClick={onClose}
              className="size-8 rounded-lg bg-[#1a3a6a]/40 hover:bg-[#1a3a6a]/70 flex items-center justify-center transition-colors"
            >
              <X className="size-4 text-[#8ab4f8]" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-5 py-3 border-b border-[#3a7bd5]/20">
            {([["floor", "Floor Plan"], ["tables", "Table Layout"]] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-4 py-1.5 rounded-lg text-xs transition-colors ${
                  tab === id
                    ? "bg-[#3a7bd5]/30 text-white"
                    : "text-[#8ab4f8] hover:bg-[#1a3a6a]/40"
                }`}
                style={{ fontFamily: "monospace", fontWeight: tab === id ? 600 : 400 }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Map area */}
          <div className="p-4">
            <div className="aspect-[4/3] w-full rounded-lg overflow-hidden border border-[#3a7bd5]/30">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="w-full h-full"
                >
                  {tab === "floor"
                    ? <FloorPlanSVG highlightRoom={room} />
                    : <TableLayoutSVG room={room} />
                  }
                </motion.div>
              </AnimatePresence>
            </div>
            <p className="text-[#5a9fff] text-[10px] text-center mt-2.5" style={{ fontFamily: "monospace" }}>
              {tab === "floor"
                ? "Your room is highlighted in orange. Follow the corridor signs."
                : `Table numbers assigned to Room ${room}. Find your project's table.`}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
