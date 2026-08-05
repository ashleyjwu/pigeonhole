"use client";

import { useActionState } from "react";

import { requestAccess, type RequestAccessState } from "@/app/request-access/actions";

const INITIAL: RequestAccessState = { status: "idle" };

export function RequestAccessForm() {
  const [state, formAction, pending] = useActionState(requestAccess, INITIAL);

  if (state.status === "ok") {
    return (
      <div className="rounded-2xl bg-neutral-900 p-6 text-center">
        <p className="font-semibold">Request sent</p>
        <p className="mt-1 text-sm text-neutral-400">
          Thanks! I&apos;ll add you to the Spotify allowlist and email you back.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-xs text-neutral-400">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          className="rounded-xl bg-neutral-900 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-xs text-neutral-400">
          Spotify account email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="rounded-xl bg-neutral-900 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="message" className="text-xs text-neutral-400">
          Anything you want to add (optional)
        </label>
        <textarea
          id="message"
          name="message"
          rows={3}
          className="rounded-xl bg-neutral-900 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Honeypot: hidden from humans, tempting to bots. */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      {state.status !== "idle" && state.message && (
        <p className="text-xs text-amber-300">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-green-500 px-6 py-3 text-sm font-semibold text-black transition hover:bg-green-400 disabled:opacity-40"
      >
        {pending ? "Sending..." : "Request access"}
      </button>
    </form>
  );
}
