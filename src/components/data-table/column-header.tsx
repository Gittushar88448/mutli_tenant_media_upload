"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, EyeOffIcon } from "lucide-react";
import type { Column } from "@tanstack/react-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTableUrl } from "./use-table-url";

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  sortKey,
  className,
}: {
  column: Column<TData, TValue>;
  title: string;
  sortKey?: string;
  className?: string;
}) {
  const { sp, set } = useTableUrl();
  if (!sortKey) return <span className={className}>{title}</span>;
  const active = sp.get("sort") === sortKey;
  const dir = active ? sp.get("dir") ?? "desc" : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn("-ml-1.5 inline-flex h-7 items-center gap-1 rounded px-1.5 uppercase hover:bg-accent hover:text-foreground data-[state=open]:bg-accent", active && "text-foreground", className)}>
          {title}
          {dir === "desc" ? <ArrowDownIcon className="size-3" /> : dir === "asc" ? <ArrowUpIcon className="size-3" /> : <ChevronsUpDownIcon className="size-3 opacity-50" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => set({ sort: sortKey, dir: "asc" })}>
          <ArrowUpIcon /> Ascending
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => set({ sort: sortKey, dir: "desc" })}>
          <ArrowDownIcon /> Descending
        </DropdownMenuItem>
        {column.getCanHide() && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => column.toggleVisibility(false)}>
              <EyeOffIcon /> Hide column
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
