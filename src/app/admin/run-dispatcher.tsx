"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminRunDispatcher } from "@/lib/actions/admin";

export function RunDispatcherButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await adminRunDispatcher();
          (r.ok ? toast.success : toast.error)(r.message);
        })
      }
    >
      <PlayIcon /> Run dispatcher (simulator)
    </Button>
  );
}
