"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** While deliveries are in flight, re-render the page every few seconds. */
export function AutoRefresh({ every = 4000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [router, every]);
  return null;
}
