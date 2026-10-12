"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Sticky contents list that follows the reader: the section nearest the top is marked. */
export function GuideToc({ items }: { items: { id: string; n: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((x): x is HTMLElement => Boolean(x));
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-72px 0px -65% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  return (
    <nav aria-label="Guide contents" className="sticky top-20">
      <p className="eyebrow mb-3">On this page</p>
      <ol className="space-y-px border-l">
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              className={cn(
                "-ml-px flex items-baseline gap-2.5 border-l-2 border-transparent py-1.5 pl-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground",
                active === i.id && "border-signal font-medium text-foreground"
              )}
            >
              <span className="font-mono text-[10px] text-signal/80">{i.n}</span>
              {i.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
