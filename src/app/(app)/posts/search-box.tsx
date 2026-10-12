"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchBox({ defaultValue, placeholder = "Search captions" }: { defaultValue?: string; placeholder?: string }) {
  const [q, setQ] = useState(defaultValue ?? "");
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    const h = setTimeout(() => {
      if ((sp.get("q") ?? "") === q) return;
      const next = new URLSearchParams(sp);
      if (q) next.set("q", q);
      else next.delete("q");
      next.delete("page");
      router.replace(`?${next.toString()}`);
    }, 300);
    return () => clearTimeout(h);
  }, [q, router, sp]);
  return (
    <div className="relative w-full md:w-72">
      <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-8 pl-8" />
    </div>
  );
}
