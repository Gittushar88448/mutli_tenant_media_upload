import { requireUser } from "@/lib/auth/session";
import { Logo } from "@/components/logo";
import { OnboardingForm } from "./form";

export default async function Onboarding() {
  const user = await requireUser();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <Logo />
      <div className="mt-10 w-full max-w-md">
        <p className="eyebrow">Welcome, {user.name.split(" ")[0]}</p>
        <h1 className="display mt-2 text-5xl">You need a workspace.</h1>
        <p className="mt-3 text-sm text-muted-foreground">You aren&apos;t a member of any active workspace. Create one to start connecting channels.</p>
        <OnboardingForm />
      </div>
    </div>
  );
}
