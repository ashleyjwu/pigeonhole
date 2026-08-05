import Link from "next/link";

import { RequestAccessForm } from "@/components/request-access-form";

export default function RequestAccessPage() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-8 bg-neutral-950 px-6 py-12 text-neutral-100">
      <header className="w-full max-w-md">
        <Link
          href="/"
          className="text-xs text-neutral-500 underline underline-offset-4 hover:text-neutral-300"
        >
          ← back
        </Link>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Request access</h1>
        <p className="mt-2 text-sm text-neutral-400">
          pigeonhole runs on Spotify&apos;s dev-mode API, which caps real sign-in
          at a handful of users. Want to try it with your own library? Send me
          your Spotify account email and I&apos;ll add you to the allowlist.
          Prefer not to sign in? The{" "}
          <Link href="/" className="underline underline-offset-4 hover:text-neutral-200">
            demo
          </Link>{" "}
          needs no account.
        </p>
      </header>

      <div className="w-full max-w-md">
        <RequestAccessForm />
      </div>
    </main>
  );
}
