import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create a workspace" };

export default function RegisterPage() {
  return (
    <div>
      <p className="eyebrow">New workspace</p>
      <h1 className="display mt-3 text-5xl">Set up your desk.</h1>
      <p className="mt-3 text-sm text-muted-foreground">One workspace per brand or client. You can add more later.</p>
      <RegisterForm />
      <p className="mt-8 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline decoration-signal decoration-2 underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
