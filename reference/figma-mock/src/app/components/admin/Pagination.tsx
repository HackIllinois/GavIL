import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPage: (p: number) => void;
  itemLabel?: string;
}

export function Pagination({ page, totalPages, totalItems, pageSize, onPage, itemLabel = "items" }: PaginationProps) {
  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, totalItems);

  const pages = buildPages(page, totalPages);

  return (
    <div className="flex items-center justify-between pt-2 pb-1">
      <span className="text-xs text-muted-foreground">
        {start}–{end} of {totalItems} {itemLabel}
      </span>
      <div className="flex items-center gap-1">
        <NavBtn onClick={() => onPage(page - 1)} disabled={page === 1} label="Previous">
          <ChevronLeft className="size-3.5" />
        </NavBtn>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`ellipsis-${i}`} className="w-7 text-center text-xs text-muted-foreground">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p as number)}
              className={`min-w-[1.75rem] h-7 rounded-lg text-xs transition-colors px-1 ${
                p === page
                  ? "bg-primary text-white"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              style={{ fontWeight: p === page ? 600 : 400 }}
            >
              {p}
            </button>
          )
        )}
        <NavBtn onClick={() => onPage(page + 1)} disabled={page === totalPages} label="Next">
          <ChevronRight className="size-3.5" />
        </NavBtn>
      </div>
    </div>
  );
}

function NavBtn({ onClick, disabled, label, children }: { onClick: () => void; disabled: boolean; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="size-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
    >
      {children}
    </button>
  );
}

function buildPages(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [];
  const add = (n: number) => { if (!pages.includes(n)) pages.push(n); };

  add(1);
  if (current > 3) pages.push("…");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) add(p);
  if (current < total - 2) pages.push("…");
  add(total);

  return pages;
}

export function usePagination(totalItems: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return { totalPages };
}
