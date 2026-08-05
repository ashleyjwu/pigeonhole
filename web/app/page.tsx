import Link from "next/link";

import { signIn, signOut } from "@/auth";
import { exitDemoAction, startDemoAction } from "@/app/actions";
import { HomeTabs } from "@/components/home-tabs";
import { resolveSession } from "@/lib/session";

export default async function Home() {
  const session = await resolveSession();

  return (
    <main className="flex min-h-screen flex-col items-center gap-10 bg-neutral-950 px-6 py-12 text-neutral-100">
      <header className="flex w-full max-w-md items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">pigeonhole</h1>
          <p className="text-xs text-neutral-500">every song has a place</p>
        </div>
        {session?.isDemo ? (
          <form action={exitDemoAction}>
            <button
              type="submit"
              className="rounded-full border border-neutral-800 px-4 py-1.5 text-xs text-neutral-400 transition hover:border-neutral-600 hover:text-white"
            >
              Exit demo
            </button>
          </form>
        ) : (
          session && (
            <form
              action={async () => {
                "use server";
                await signOut();
              }}
            >
              <button
                type="submit"
                className="rounded-full border border-neutral-800 px-4 py-1.5 text-xs text-neutral-400 transition hover:border-neutral-600 hover:text-white"
              >
                Sign out
              </button>
            </form>
          )
        )}
      </header>

      {session?.isDemo && (
        <div className="w-full max-w-md rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-2.5 text-center text-xs text-green-300">
          Demo mode — sample library, real recommendations. Adding songs is
          simulated.
        </div>
      )}

      {session ? (
        <HomeTabs isDemo={session.isDemo} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <p className="max-w-sm text-neutral-400">
            Hear a song you like? pigeonhole finds the right playlist for it in
            one tap.
          </p>
          <form action={startDemoAction}>
            <button
              type="submit"
              className="rounded-full bg-green-500 px-8 py-3 font-semibold text-black transition hover:bg-green-400"
            >
              Try the demo
            </button>
          </form>
          <form
            action={async () => {
              "use server";
              await signIn("spotify");
            }}
          >
            <button
              type="submit"
              className="rounded-full border border-neutral-700 px-8 py-3 text-sm font-medium text-neutral-200 transition hover:border-neutral-500"
            >
              Continue with Spotify
            </button>
          </form>
          <Link
            href="/request-access"
            className="text-xs text-neutral-500 underline underline-offset-4 hover:text-neutral-300"
          >
            Want to try it with your own Spotify? Request access
          </Link>
        </div>
      )}
    </main>
  );
}
