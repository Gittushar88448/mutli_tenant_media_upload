"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type VisibilityState,
  type Row,
} from "@tanstack/react-table";
import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon, Settings2Icon, XIcon, SearchIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DataTableFacetedFilter, type FacetOption } from "./faceted-filter";
import { useTableUrl } from "./use-table-url";

export type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  total: number;
  page: number;
  size: number;
  getRowId: (row: TData) => string;
  searchPlaceholder?: string;
  filters?: { param: string; title: string; options: FacetOption[] }[];
  bulkActions?: (rows: Row<TData>[], clear: () => void) => React.ReactNode;
  toolbarExtra?: React.ReactNode;
  initialHidden?: VisibilityState;
  onRowClick?: (row: TData) => void;
};

/** Selection column used by every admin table. */
export function selectColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => <Checkbox checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} onClick={(e) => e.stopPropagation()} aria-label="Select row" />,
    enableSorting: false,
    enableHiding: false,
    size: 32,
  };
}

/**
 * Server-driven shadcn data table: TanStack handles columns, selection and visibility;
 * paging, sorting, search and facets live in the URL and are answered by a MongoDB
 * aggregation on the server.
 */
export function DataTable<TData>({
  columns,
  data,
  total,
  page,
  size,
  getRowId,
  searchPlaceholder = "Search…",
  filters = [],
  bulkActions,
  toolbarExtra,
  initialHidden = {},
  onRowClick,
}: DataTableProps<TData>) {
  const { sp, set, pending } = useTableUrl();
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(initialHidden);
  const [q, setQ] = React.useState(sp.get("q") ?? "");

  React.useEffect(() => setRowSelection({}), [data]);
  React.useEffect(() => {
    const h = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) set({ q });
    }, 300);
    return () => clearTimeout(h);
  }, [q, sp, set]);

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { rowSelection, columnVisibility },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableRowSelection: true,
    pageCount: Math.max(1, Math.ceil(total / size)),
  });

  const pages = Math.max(1, Math.ceil(total / size));
  const selected = table.getSelectedRowModel().rows;
  const filtered = filters.some((f) => sp.get(f.param)) || !!sp.get("q");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="h-8 w-56 pl-8 lg:w-72" />
        </div>
        {filters.map((f) => (
          <DataTableFacetedFilter key={f.param} {...f} />
        ))}
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              set(Object.fromEntries([["q", null], ...filters.map((f) => [f.param, null])]));
            }}
          >
            Reset <XIcon />
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {toolbarExtra}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <Settings2Icon /> View
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} className="capitalize">
                    {(c.columnDef.meta as { label?: string } | undefined)?.label ?? c.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {selected.length > 0 && bulkActions && (
        <div className="flex items-center gap-3 rounded-xl border border-foreground bg-foreground px-3 py-2 text-background">
          <span className="font-mono text-xs">{selected.length} selected</span>
          <div className="flex flex-wrap items-center gap-2 [&_button]:h-7">{bulkActions(selected, () => setRowSelection({}))}</div>
          <button className="ml-auto text-xs opacity-70 hover:opacity-100" onClick={() => setRowSelection({})}>
            Clear
          </button>
        </div>
      )}

      <div className={cn("overflow-hidden rounded-xl border bg-card transition-opacity", pending && "opacity-60")}>
        <Table>
          <TableHeader className="bg-muted/40">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => (
                  <TableHead key={h.id} style={h.column.id === "select" ? { width: 36 } : undefined}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"} className={onRowClick ? "cursor-pointer" : undefined} onClick={onRowClick ? () => onRowClick(row.original) : undefined}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-muted-foreground">
          {total === 0 ? "0 rows" : `${(page - 1) * size + 1}–${Math.min(page * size, total)} of ${total.toLocaleString()}`}
        </p>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Rows
            <Select value={String(size)} onValueChange={(v) => set({ size: v })}>
              <SelectTrigger size="sm" className="h-8 w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 20, 50, 100].map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="font-mono text-xs">
            Page {page} / {pages}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => set({ page: "1" }, false)} aria-label="First page">
              <ChevronsLeftIcon />
            </Button>
            <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) }, false)} aria-label="Previous page">
              <ChevronLeftIcon />
            </Button>
            <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) }, false)} aria-label="Next page">
              <ChevronRightIcon />
            </Button>
            <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => set({ page: String(pages) }, false)} aria-label="Last page">
              <ChevronsRightIcon />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
