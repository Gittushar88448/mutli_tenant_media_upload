"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/** Data tables keep their page/sort/filter state in the URL so the server can paginate with $facet. */
export function useTableUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  const set = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(sp);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (resetPage && !("page" in patch)) next.delete("page");
      start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
    },
    [sp, pathname, router]
  );

  return { sp, set, pending };
}
