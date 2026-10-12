"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckIcon, HandIcon, PlugIcon } from "lucide-react";
import { COMMUNITY_GUIDES, type GuideStep } from "@/lib/guide";
import { PLATFORMS, type CommunityId } from "@/lib/platforms";
import { PlatformIcon } from "@/components/platform-icon";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const IDS = Object.keys(COMMUNITY_GUIDES) as CommunityId[];
const PREFIX = "#community-";

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
/** "#community-discord" in the URL opens that tab, so other pages can deep-link a platform. */
function hashTab(): CommunityId | null {
  const h = window.location.hash;
  return h.startsWith(PREFIX) && IDS.includes(h.slice(PREFIX.length) as CommunityId) ? (h.slice(PREFIX.length) as CommunityId) : null;
}

export function CommunityTabs({ connected, canManage }: { connected: Record<string, number>; canManage: boolean }) {
  const fromHash = useSyncExternalStore(subscribe, hashTab, () => null);
  const [picked, setPicked] = useState<{ tab: CommunityId; hash: CommunityId | null } | null>(null);
  // A tab the reader clicked wins until the URL's hash changes again.
  const value = picked && picked.hash === fromHash ? picked.tab : (fromHash ?? IDS[0]!);

  return (
    <div className="relative">
      {IDS.map((id) => (
        <span key={id} id={`community-${id}`} className="absolute -top-24" aria-hidden />
      ))}
      <Tabs value={value} onValueChange={(v) => setPicked({ tab: v as CommunityId, hash: fromHash })}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            {IDS.map((id) => (
              <TabsTrigger key={id} value={id}>
                <PlatformIcon platform={id} className="size-3.5" />
                {PLATFORMS[id].name}
                {connected[id] ? <CheckIcon className="size-3 text-ok" /> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {IDS.map((id) => {
          const g = COMMUNITY_GUIDES[id];
          const spec = PLATFORMS[id];
          return (
            <TabsContent key={id} value={id} className="mt-2">
              <div className="grid gap-6 rounded-xl border bg-card p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="min-w-0">
                  <p className="text-sm leading-relaxed text-muted-foreground">{g.intro}</p>
                  {g.alt && <p className="mt-4 eyebrow">Cloud API (automatic)</p>}
                  <Steps steps={g.steps} />
                  {g.alt && (
                    <>
                      <p className="mt-6 flex items-center gap-1.5 eyebrow">
                        <HandIcon className="size-3" /> {g.alt.title}
                      </p>
                      <Steps steps={g.alt.steps} />
                    </>
                  )}
                </div>
                <aside className="flex flex-col gap-4 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
                  <div>
                    <p className="eyebrow mb-2">What you can send</p>
                    <ul className="space-y-1.5 text-[13px]">
                      {g.good.map((x) => (
                        <li key={x} className="flex gap-2">
                          <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-ok" />
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-auto">
                    {connected[id] ? <p className="mb-2 font-mono text-[11px] text-muted-foreground">{connected[id]} connected in this workspace</p> : null}
                    {canManage ? (
                      <Button asChild variant="outline" size="sm" className="w-full">
                        <Link href={`/communities?connect=${id}#add`}>
                          <PlugIcon /> Connect {spec.name}
                        </Link>
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">Ask a workspace admin to connect it.</p>
                    )}
                  </div>
                </aside>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

function Steps({ steps }: { steps: GuideStep[] }) {
  return (
    <ol className="mt-3 space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="grid grid-cols-[24px_1fr] gap-2 text-[14px] leading-relaxed">
          <span className="mt-0.5 flex size-5 items-center justify-center rounded-full border font-mono text-[10.5px] text-muted-foreground">{i + 1}</span>
          <div>
            {s.text}
            {s.code && <code className="mt-1.5 block w-fit rounded-[6px] border bg-muted/50 px-2 py-0.5 font-mono text-[12px] text-muted-foreground">{s.code}</code>}
          </div>
        </li>
      ))}
    </ol>
  );
}
