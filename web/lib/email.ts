/**
 * Access-request email delivery via Resend's REST API (no SDK dependency).
 *
 * Free-tier friendly: sends from Resend's shared `onboarding@resend.dev`
 * sender to the owner's own inbox, which needs no custom domain or DNS.
 * Set RESEND_API_KEY and ACCESS_REQUEST_EMAIL to enable; when unset, the
 * request is logged server-side instead so nothing is silently lost in
 * local dev.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface AccessRequest {
  name: string;
  email: string;
  message: string;
}

export async function sendAccessRequestEmail(
  request: AccessRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ACCESS_REQUEST_EMAIL;

  if (!apiKey || !to) {
    // Not configured (e.g. local dev): don't lose the request — log it.
    console.info(
      "[access-request] (email not configured) " +
        `name=${request.name} email=${request.email} message=${request.message}`,
    );
    return;
  }

  const text = [
    "New pigeonhole access request:",
    "",
    `Name:    ${request.name}`,
    `Email:   ${request.email}`,
    "",
    request.message,
  ].join("\n");

  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "pigeonhole <onboarding@resend.dev>",
      to: [to],
      reply_to: request.email,
      subject: `pigeonhole access request from ${request.name}`,
      text,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend send failed: HTTP ${response.status}`);
  }
}
