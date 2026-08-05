"use server";

import { headers } from "next/headers";

import { sendAccessRequestEmail } from "@/lib/email";
import { checkAccessRequestLimit, clientIpFrom } from "@/lib/rate-limit";

export interface RequestAccessState {
  status: "idle" | "ok" | "error" | "rate-limited" | "invalid";
  message?: string;
}

const EMAIL_RE = /.+@.+\..+/;

export async function requestAccess(
  _prev: RequestAccessState,
  formData: FormData,
): Promise<RequestAccessState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const honeypot = String(formData.get("company") ?? "").trim();

  // A real user never fills the hidden "company" field; a bot usually does.
  // Pretend success and send nothing.
  if (honeypot) {
    return { status: "ok" };
  }
  if (!name || !EMAIL_RE.test(email)) {
    return { status: "invalid", message: "Please enter your name and a valid email." };
  }

  const ip = clientIpFrom(await headers());
  if (!checkAccessRequestLimit(ip)) {
    return {
      status: "rate-limited",
      message: "Too many requests — please try again in a few minutes.",
    };
  }

  try {
    await sendAccessRequestEmail({ name, email, message });
    return { status: "ok" };
  } catch (error) {
    console.error("requestAccess failed", error);
    return { status: "error", message: "Something went wrong. Please try again later." };
  }
}
