import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div>
      <p className="eyebrow">Sign in</p>
      <h1 className="display mt-3 text-5xl">Back to the desk.</h1>
      <p className="mt-3 text-sm text-muted-foreground">Your queue kept running while you were away.</p>
      <LoginForm next={next} />
      <p className="mt-8 text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/register" className="font-medium text-foreground underline decoration-signal decoration-2 underline-offset-4">
          Create a workspace
        </Link>
      </p>
    </div>
  );
}
