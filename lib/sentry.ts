/**
 * Sentry placeholder — lightweight, framework-agnostic wrapper. Plugging in
 * `@sentry/nextjs` on D14 is a matter of replacing these fns and adding the
 * wizard-generated `instrumentation.ts` + client/server config files.
 */

export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (typeof window === "undefined") {
    console.error("[sentry]", err, context);
  } else {
    // Browser path — sends to /api/errors endpoint or Sentry DSN in prod.
    fetch("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: String(err), context }),
      keepalive: true,
    }).catch(() => {});
  }
}

export function captureMessage(msg: string, context?: Record<string, unknown>) {
  console.info("[sentry:info]", msg, context);
}
