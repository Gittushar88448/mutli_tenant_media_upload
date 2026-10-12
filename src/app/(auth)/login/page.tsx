import type { Metadata } from "next";
import Link from "next/link";
import { googleAuthConfig } from "@/lib/auth/google";
import { demoMode } from "@/lib/publishing/n8n";
import { GoogleButton, OrDivider } from "@/components/auth/google-button";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: "Google sign-in was cancelled.",
  google_expired: "That sign-in link expired. Try Continue with Google again.",
  google_unverified: "Google hasn't verified that email address, so it can't be used to sign in.",
  google_closed: "New sign-ups are closed right now.",
  google_suspended: "This account is suspended. Contact support.",
  google_off: "Google sign-in isn't set up on this server.",
  google_exchange: "Google didn't accept the sign-in. Try again.",
  google_token: "Google's answer couldn't be verified. Try again.",
  google_failed: "Google sign-in didn't work. Try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const google = Boolean(googleAuthConfig());
  return (
    <div>
      <p className="eyebrow">Sign in</p>
      <h1 className="display mt-3 text-5xl">Back to the desk.</h1>
      <p className="mt-3 text-sm text-muted-foreground">Your queue kept running while you were away.</p>
      {error && GOOGLE_ERRORS[error] && <p className="mt-6 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">{GOOGLE_ERRORS[error]}</p>}
      {(google || demoMode()) && (
        <>
          <GoogleButton label="Continue with Google" next={next} enabled={google} className="mt-8" />
          <OrDivider />
        </>
      )}
      <LoginForm next={next} compact={google || demoMode()} />
      <p className="mt-8 text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/register" className="font-medium text-foreground underline decoration-signal decoration-2 underline-offset-4">
          Create a workspace
        </Link>
      </p>
    </div>
  );
}
