"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, PencilIcon, RotateCcwIcon, XIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cancelPostAction, deletePostAction, markManualDoneAction, retryTargetAction, reviewPostAction } from "@/lib/actions/posts";

export function PostActions({ postId, status, canEdit, canApprove }: { postId: string; status: string; canEdit: boolean; canApprove: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!canEdit) return null;
  return (
    <>
      {status === "pending_approval" && canApprove && (
        <>
          <Button variant="outline" disabled={pending} onClick={() => start(async () => { await reviewPostAction(postId, "rejected"); toast("Sent back to drafts"); })}>
            <XIcon /> Send back
          </Button>
          <Button variant="signal" disabled={pending} onClick={() => start(async () => { await reviewPostAction(postId, "approved"); toast.success("Approved"); })}>
            <CheckIcon /> Approve
          </Button>
        </>
      )}
      {["draft", "scheduled", "pending_approval"].includes(status) && (
        <Button variant="outline" asChild>
          <Link href={`/compose?post=${postId}`}>
            <PencilIcon /> Edit
          </Link>
        </Button>
      )}
      {["scheduled", "pending_approval", "publishing", "partially_failed"].includes(status) && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={pending}>
              Cancel post
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this post?</AlertDialogTitle>
              <AlertDialogDescription>Channels that haven&apos;t started uploading are cancelled. Anything already uploading finishes, and published posts stay up.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => start(async () => { await cancelPostAction(postId); toast("Post cancelled"); })}>
                Cancel post
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {["draft", "cancelled"].includes(status) && (
        <Button
          variant="ghost"
          className="text-destructive"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await deletePostAction(postId);
              toast("Deleted");
              router.push("/posts");
            })
          }
        >
          <Trash2Icon /> Delete
        </Button>
      )}
    </>
  );
}

export function TargetActions({ targetId, status, platform, canEdit }: { targetId: string; status: string; platform: string; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState("");
  if (!canEdit) return null;
  if (platform === "manual" && status === "needs_action") {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="signal">
            <CheckIcon /> Mark posted
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="grid gap-2">
          <p className="text-sm font-medium">Where did it go up?</p>
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https:// (optional)" />
          <Button size="sm" disabled={pending} onClick={() => start(async () => { await markManualDoneAction(targetId, link); toast.success("Marked as posted"); })}>
            Done
          </Button>
        </PopoverContent>
      </Popover>
    );
  }
  if (["failed", "needs_action"].includes(status)) {
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await retryTargetAction(targetId); toast("Retrying"); })}>
        <RotateCcwIcon /> Retry
      </Button>
    );
  }
  return null;
}
