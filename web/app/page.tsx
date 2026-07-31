import { auth, signIn, signOut } from "@/auth";
import { HomeTabs } from "@/components/home-tabs";

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex min-h-screen flex-col items-center gap-10 bg-neutral-950 px-6 py-12 text-neutral-100">
      <header className="flex w-full max-w-md items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">pigeonhole</h1>
          <p className="text-xs text-neutral-500">every song has a place</p>
        </div>
        {session?.user && (
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
        )}
      </header>

      {session?.user ? (
        <HomeTabs />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <p className="max-w-sm text-neutral-400">
            Hear a song you like? pigeonhole finds the right playlist for it in
            one tap.
          </p>
          <form
            action={async () => {
              "use server";
              await signIn("spotify");
            }}
          >
            <button
              type="submit"
              className="rounded-full bg-green-500 px-8 py-3 font-semibold text-black transition hover:bg-green-400"
            >
              Continue with Spotify
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
