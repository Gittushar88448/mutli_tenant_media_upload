"use client";

import { CheckIcon, PlusCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useTableUrl } from "./use-table-url";

export type FacetOption = { value: string; label: string; icon?: React.ReactNode };

export function DataTableFacetedFilter({ param, title, options }: { param: string; title: string; options: FacetOption[] }) {
  const { sp, set } = useTableUrl();
  const selected = new Set((sp.get(param) ?? "").split(",").filter(Boolean));
  const update = (s: Set<string>) => set({ [param]: [...s].join(",") || null });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed">
          <PlusCircleIcon />
          {title}
          {selected.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              {selected.size > 2 ? (
                <Badge variant="secondary">{selected.size} selected</Badge>
              ) : (
                options
                  .filter((o) => selected.has(o.value))
                  .map((o) => (
                    <Badge key={o.value} variant="secondary">
                      {o.label}
                    </Badge>
                  ))
              )}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = selected.has(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    onSelect={() => {
                      const s = new Set(selected);
                      if (on) s.delete(o.value);
                      else s.add(o.value);
                      update(s);
                    }}
                  >
                    <span className={cn("flex size-4 items-center justify-center rounded-[5px] border", on ? "border-primary bg-primary text-primary-foreground" : "opacity-60")}>
                      {on && <CheckIcon className="size-3 text-primary-foreground" />}
                    </span>
                    {o.icon}
                    <span>{o.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => update(new Set())} className="justify-center text-center">
                    Clear filter
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
