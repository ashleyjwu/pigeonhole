import { auth, signIn, signOut } from "@/auth";

export default async function Home() {
  const session = await auth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-neutral-950 px-6 text-neutral-100">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight">pigeonhole</h1>
        <p className="mt-3 max-w-md text-neutral-400">
          Every song has a place. Find the right playlist for what you are
          listening to, in one tap.
        </p>
      </div>

      {session?.user ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-lg">
            Signed in as{" "}
            <span className="font-semibold">
              {session.user.name ?? "Spotify user"}
            </span>
          </p>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button
              type="submit"
              className="rounded-full border border-neutral-700 px-6 py-2 text-sm font-medium text-neutral-300 transition hover:border-neutral-500 hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : (
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
      )}
    </main>
  );
}
