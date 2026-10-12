import { requireUser } from "@/lib/auth/session";
import { Logo } from "@/components/logo";
import { OnboardingForm } from "./form";

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await requireUser();
  const { welcome } = await searchParams;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <Logo />
      <div className="mt-10 w-full max-w-md">
        <p className="eyebrow">Welcome, {user.name.split(" ")[0]}</p>
        {welcome ? (
          <>
            <h1 className="display mt-2 text-5xl">Name your desk.</h1>
            <p className="mt-3 text-sm text-muted-foreground">One workspace per brand or client, usually your brand&apos;s name. You can add more later.</p>
          </>
        ) : (
          <>
            <h1 className="display mt-2 text-5xl">You need a workspace.</h1>
            <p className="mt-3 text-sm text-muted-foreground">You aren&apos;t a member of any active workspace. Create one to start connecting channels.</p>
          </>
        )}
        <OnboardingForm />
      </div>
    </div>
  );
}
