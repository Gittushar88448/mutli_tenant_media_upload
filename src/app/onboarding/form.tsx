"use client";

import { useActionState } from "react";
import { createWorkspaceAction } from "@/lib/actions/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createWorkspaceAction, undefined);
  return (
    <form action={action} className="mt-6 flex gap-2">
      <Input name="name" placeholder="Workspace name" required />
      <Button disabled={pending}>Create</Button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
