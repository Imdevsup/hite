# Security

## What there is to attack

HITE is a **self-hosted application**. There is no hosted multi-tenant HITE, no shared account
system, and no central store of anyone's footage. `www.tryhite.xyz` is a landing page; the editor
runs on the machine of whoever cloned this repo, against **their own** Supabase project and **their
own** model API key. A vulnerability here is a vulnerability in software an operator runs, not in a
service we run on their behalf. That operator may well have put it on a public URL, though, which is
the case the model below is written for.

## The security model, in the terms the code actually uses

- **Row-level security is the isolation boundary, not obscurity.** Every table is scoped by
  `project.owner_user_id` and has RLS enabled (`supabase/migrations/001_init.sql`, `005`, `006`).
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` is public by design: it ships in the browser bundle and the
  browser uploads with it. `tests/integration/rls.test.ts` proves that boundary against a live
  stack rather than asserting it, for both named and anonymous sessions.
- **`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely.** It is read only by server code and by
  `pnpm worker`. Anything that leaks it (a client bundle, a log line, an error body, a screenshot
  pasted into an issue) is a full compromise of that deployment's data. Treat any path that could
  carry it to a browser as critical.
- **Storage objects are owned by a path prefix.** `media` and `exports` are private buckets, and the
  `own_prefix_*` policies in `005_storage.sql` allow a session to touch only objects under its own
  `{userId}/` folder. An object at a bucket root matches no policy and is reachable by nobody.
  `previews` is public and is written only by the service role.
- **Sessions are anonymous and the cookie is the only key.** `middleware.ts` mints a Supabase
  anonymous session on the first `/app/*` request so `auth.uid()` exists and every policy keeps
  working. There is no login page and no account recovery. API routes deliberately do not mint one:
  they answer `401`, because minting on `/api/*` would create a user row for every unauthenticated
  request that reaches it.
- **Model API keys belong to the user and are never stored.** The credential travels in exactly one
  channel, the `x-hite-provider-key` request header. Never a URL, never the JSON body, never an
  environment variable on a request path; `lib/ai/providers/credential.ts` gives the reason for each.
  The browser holds it in `sessionStorage`, which dies with the tab. `redactProviderKey()` strips it,
  in both raw and percent-encoded form, out of anything that could reach a chat bubble or an error
  report. There is no deployer key pool to fall back to, so a keyless request is a `402`.
- **The self-hosted-provider base URL is an SSRF surface and is gated as one.**
  `requireLoopbackBaseUrl()` rejects anything but a loopback host, checked on the parsed hostname
  rather than the raw string, and the provider entry is refused outright unless the operator sets
  `HITE_ALLOW_LOCAL_PROVIDER=1`.
- **The worker feeds untrusted files to native code.** `pnpm worker` runs ffmpeg/ffprobe and a
  headless Chromium over whatever a user uploaded. Operators exposing HITE publicly should run the
  worker somewhere it can be contained, and should give it no credentials beyond the two variables
  it needs.

## Reporting a vulnerability

**Use GitHub's private security advisories:**
<https://github.com/Imdevsup/hite/security/advisories/new>

Please do not open a public issue, a PR or a discussion for something exploitable. The advisory form
stays private until we publish it, and it is the only channel here: there is no email address to
write to and no bug bounty.

Useful in a report: the version or commit, whether the deployment is local or hosted, the route or
file involved, and the smallest reproduction you have. **Never paste a real API key, a real
service-role key, or real footage.** A redacted key and a synthetic clip are enough, and a live
credential in an advisory is a second incident.

This is a small project maintained in spare time. You will get a human reply, but no response-time
promise beyond that: expect acknowledgement in days rather than hours, and a fix on the default
branch rather than a backported release. Only the latest commit on the default branch is supported.

If you find something in what `www.tryhite.xyz` currently serves, say so explicitly. The live site is an
older build than this tree, so a finding there may not exist here, and the reverse is also true.
