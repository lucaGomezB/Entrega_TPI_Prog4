/**
 * DataTable — Generic paginated data table component with sortable columns.
 *
 * Features:
 *   - Desktop: full table with all columns.
 *   - Mobile: hides columns with `hideOnMobile`, horizontal scroll.
 *   - Pagination: prev/next buttons, "Pagina X de Y", limit selector (10/25/50).
 *   - Sorting: clickable column headers with arrow indicators.
 *   - Empty state: customizable message.
 *   - Loading state: skeleton rows.
 *
 * Type parameter <T> represents the row data type.
 */
import { type ReactNode } from "react";
import { TableRowSkeleton } from "@/shared/components/Skeleton";

// ── Types ──

export interface DataTableColumn<T> {
  /** Unique key for this column. Also used as sort field when sortable is true. */
  key: string;
  /** Header label displayed in the table head. */
  label: string;
  /** Custom render function. If omitted, renders `row[key]` as a string. */
  render?: (row: T) => ReactNode;
  /** When true, the column is hidden on mobile screens (< md breakpoint). */
  hideOnMobile?: boolean;
  /** When true, the header is clickable to sort by this column. */
  sortable?: boolean;
}

export interface DataTableProps<T> {
  /** Column definitions. */
  columns: DataTableColumn<T>[];
  /** The rows of data to display for the current page. */
  data: T[];
  /** Total number of items across all pages (for pagination info). */
  total: number;
  /** Current skip offset (0-based). */
  skip: number;
  /** Current page size (limit). */
  limit: number;
  /** Called when the user changes pages. Receives the new skip value. */
  onPageChange: (skip: number) => void;
  /** Called when the user changes the page size. */
  onLimitChange?: (limit: number) => void;
  /** Current sort field (key of the sorted column). */
  sortBy?: string;
  /** Current sort direction. */
  sortOrder?: "asc" | "desc";
  /** Called when the user clicks a sortable column header. */
  onSort?: (sortBy: string, sortOrder: "asc" | "desc") => void;
  /** When true, skeleton rows are shown instead of data. */
  isLoading?: boolean;
  /** Custom empty state message. Defaults to "No hay datos disponibles". */
  emptyMessage?: string;
  /** Optional CSS class for the wrapper. */
  className?: string;
  /** Optional per-row className function. Receives the row data; return a CSS class string or undefined. */
  getRowClassName?: (row: T) => string | undefined;
}

// ── Helpers ──

const LIMIT_OPTIONS = [10, 25, 50] as const;

function getDefaultRender<T>(row: T, key: string): ReactNode {
  const value = (row as Record<string, unknown>)[key];
  if (value === null || value === undefined) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "-";
}

// ── Component ──

export default function DataTable<T>({
  columns,
  data,
  total,
  skip,
  limit,
  onPageChange,
  onLimitChange,
  sortBy,
  sortOrder = "desc",
  onSort,
  isLoading = false,
  emptyMessage = "No hay datos disponibles",
  className = "",
  getRowClassName,
}: DataTableProps<T>) {
  const currentPage = Math.floor(skip / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const isFirstPage = currentPage <= 1;
  const isLastPage = skip + limit >= total;

  function handleHeaderClick(col: DataTableColumn<T>) {
    if (!col.sortable || !onSort) return;
    if (sortBy === col.key) {
      // Toggle direction
      const newOrder = sortOrder === "asc" ? "desc" : "asc";
      onSort(col.key, newOrder);
    } else {
      // New column: default to asc
      onSort(col.key, "asc");
    }
  }

  return (
    <div className={`rounded-lg shadow border border-gray-200 bg-white ${className}`}>
      {/* ── Table ── */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-600 uppercase text-xs tracking-wider sticky top-0 z-10">
              {columns.map((col) => {
                const isSorted = col.sortable && sortBy === col.key;
                const arrow = isSorted ? (sortOrder === "asc" ? " ↑" : " ↓") : "";
                return (
                  <th
                    key={col.key}
                    className={`px-3 py-3 text-left font-semibold whitespace-nowrap ${
                      col.hideOnMobile ? "hidden md:table-cell" : ""
                    } ${col.sortable && onSort ? "cursor-pointer select-none hover:bg-gray-200" : ""}`}
                    onClick={col.sortable && onSort ? () => handleHeaderClick(col) : undefined}
                    role={col.sortable ? "columnheader" : undefined}
                    aria-sort={isSorted ? (sortOrder === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {col.label}
                    {arrow && <span className="text-blue-600">{arrow}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {/* ── Loading state ── */}
            {isLoading && (
              <tr>
                <td colSpan={columns.length} className="p-4">
                  <TableRowSkeleton columns={columns.length} rows={limit} />
                </td>
              </tr>
            )}

            {/* ── Empty state ── */}
            {!isLoading && data.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-12 text-center text-gray-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}

            {/* ── Data rows ── */}
            {!isLoading &&
              data.map((row, rowIdx) => {
                const rowClass = getRowClassName ? getRowClassName(row) : undefined;
                return (
                <tr
                  key={(row as { id?: number }).id ?? rowIdx}
                  className={`hover:bg-blue-50 transition-colors ${rowClass ?? ""}`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2.5 ${
                        col.hideOnMobile ? "hidden md:table-cell" : ""
                      }`}
                    >
                      {col.render
                        ? col.render(row)
                        : getDefaultRender(row, col.key)}
                    </td>
                  ))}
                </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination footer ── */}
      {total > 0 && (
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 px-3 py-3 border-t border-gray-200">
          {/* Limit selector */}
          {onLimitChange && (
            <div className="flex items-center gap-2">
              <label htmlFor="dt-limit" className="text-xs text-gray-500">
                Items por pagina:
              </label>
              <select
                id="dt-limit"
                value={limit}
                onChange={(e) => onLimitChange(Number(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1 text-xs min-w-[44px] min-h-[44px] cursor-pointer"
              >
                {LIMIT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Page info + nav */}
          <div className="flex items-center gap-3">
            {/* Previous */}
            <button
              onClick={() => onPageChange(Math.max(0, skip - limit))}
              disabled={isFirstPage || isLoading}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center px-3 py-1.5 text-sm border border-gray-300 rounded bg-white hover:bg-gray-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Pagina anterior"
            >
              Anterior
            </button>

            {/* Page indicator */}
            <span className="text-sm text-gray-600 whitespace-nowrap">
              Pagina {currentPage} de {totalPages}
            </span>

            {/* Next */}
            <button
              onClick={() => onPageChange(skip + limit)}
              disabled={isLastPage || isLoading}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center px-3 py-1.5 text-sm border border-gray-300 rounded bg-white hover:bg-gray-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Pagina siguiente"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
