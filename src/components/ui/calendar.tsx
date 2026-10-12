"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DayPicker, getDefaultClassNames } from "react-day-picker";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

function Calendar({ className, classNames, showOutsideDays = true, ...props }: React.ComponentProps<typeof DayPicker>) {
  const d = getDefaultClassNames();
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 [--cell-size:2.1rem]", className)}
      classNames={{
        root: cn("w-fit", d.root),
        months: cn("relative flex flex-col gap-4 md:flex-row", d.months),
        month: cn("flex w-full flex-col gap-3", d.month),
        nav: cn("absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1", d.nav),
        button_previous: cn(buttonVariants({ variant: "ghost" }), "size-(--cell-size) p-0 aria-disabled:opacity-50", d.button_previous),
        button_next: cn(buttonVariants({ variant: "ghost" }), "size-(--cell-size) p-0 aria-disabled:opacity-50", d.button_next),
        month_caption: cn("flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)", d.month_caption),
        caption_label: cn("font-serif text-lg", d.caption_label),
        weekdays: cn("flex", d.weekdays),
        weekday: cn("flex-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground select-none", d.weekday),
        week: cn("mt-1 flex w-full", d.week),
        day: cn("relative aspect-square h-full w-full p-0 text-center select-none", d.day),
        today: cn("[&>button]:underline [&>button]:decoration-signal [&>button]:decoration-2 [&>button]:underline-offset-4", d.today),
        outside: cn("text-muted-foreground/50", d.outside),
        disabled: cn("text-muted-foreground opacity-40", d.disabled),
        hidden: cn("invisible", d.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className, ...p }) =>
          orientation === "left" ? (
            <ChevronLeftIcon className={cn("size-4", className)} {...p} />
          ) : (
            <ChevronRightIcon className={cn("size-4", className)} {...p} />
          ),
        DayButton: ({ className, modifiers, ...p }) => (
          <button
            className={cn(
              "flex size-(--cell-size) items-center justify-center rounded-md text-sm tabular-nums hover:bg-accent",
              modifiers.selected && "bg-primary text-primary-foreground hover:bg-primary",
              className
            )}
            {...p}
          />
        ),
      }}
      {...props}
    />
  );
}

export { Calendar };
