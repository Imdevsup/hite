import { z } from "zod";
import { BadRequestError, HttpError } from "@/lib/api/errors";
import { effortProfileFor, type EffortProfile } from "@/lib/ai/effort";
import {
  PROVIDER_ID_HEADER,
  PROVIDER_MODEL_HEADER,
  assertModelId,
  readBaseUrlHeader,
  readModelHeader,
  readProviderIdHeader,
  readSurfaceHeader,
  requireLoopbackBaseUrl,
  resolveProviderKey,
  type KeySource,
} from "./credential";
import { capabilitiesFor, findProviderEntry, findProviderModel, providerAvailable, unavailableReason } from "./registry";
import type { ModelSelection, ModelSurface, ProviderCapabilities, ProviderEntry } from "./types";

/**
 * RESOLVING ONE RUN — provider, model, credential and rung, in a single call an expensive route
 * cannot write wrong.
 *
 * BYOK IS THE ONLY PATH. There is no deployer key pool and no fallback to one: a request with no
 * usable credential is a 402 pointing at the settings surface, always. That is the whole reason this
 * function exists rather than three separate reads — the "resolve the key, then maybe fall through
 * to something else" shape is precisely what let a keyless request quietly spend somebody else's
 * money, and there is now nowhere for it to fall through TO.
 *
 * WHERE THE FIELDS COME FROM. The key rides its own header and nothing else (`credential.ts`
 * explains why). The provider id, model id, surface and local base URL are NOT secrets, so they may
 * arrive either in the JSON body — which a route validates with zod and is the shape U8 §7.6
 * specifies — or in matching headers. The body WINS when present; the headers exist so a route that
 * has not yet been taught to parse the fields still gets the user's real selection instead of a
 * silent default, which would be the worst of both worlds: a user who picked Anthropic in the UI and
 * whose key is quietly sent to Google.
 */

/** What a route's zod body may carry. Every field optional — headers cover the rest. */
export const ProviderSelectionBody = z.object({
  provider: z.string().max(40).optional(),
  model: z.string().max(200).optional(),
  surface: z.enum(["chat", "responses"]).optional(),
  baseUrl: z.string().max(300).optional(),
});
export type ProviderSelectionBody = z.infer<typeof ProviderSelectionBody>;

/**
 * The provider a request with no stated provider gets.
 *
 * Google, because every client that predates the multi-provider header sends only a key header and
 * that key is a Gemini key. A default is a real choice with a real failure mode, so it is written
 * down here rather than spread across call sites, and the settings UI always sends the field.
 */
export const DEFAULT_PROVIDER_ID = "google";

export interface ProviderRun {
  readonly entry: ProviderEntry;
  readonly selection: ModelSelection;
  readonly capabilities: ProviderCapabilities;
  readonly credential: KeySource;
  readonly effort: EffortProfile;
}

/** 402, not 401 or 503: the request is well-formed and the caller is authenticated — what is missing
 *  is payment. The client keys off the status; the message never repeats anything the caller sent. */
export const NO_KEY_MESSAGE = "add your own provider API key in settings to continue";

function resolveEntry(req: Request, body: ProviderSelectionBody | undefined): ProviderEntry {
  const requested = body?.provider ?? readProviderIdHeader(req) ?? DEFAULT_PROVIDER_ID;
  const entry = findProviderEntry(requested);
  if (!entry) {
    // Naming the field and not echoing the value keeps a hostile id out of the log and the response.
    throw new BadRequestError(`${PROVIDER_ID_HEADER}: unknown provider`);
  }
  if (!providerAvailable(entry)) {
    throw new BadRequestError(`${entry.id}: ${unavailableReason(entry) ?? "not available on this deployment"}`);
  }
  return entry;
}

function resolveModelId(req: Request, entry: ProviderEntry, body: ProviderSelectionBody | undefined): string {
  const requested = body?.model ?? readModelHeader(req);
  if (requested) return assertModelId(requested);
  const first = entry.models[0]?.id;
  if (first) return first;
  // `local` ships no model list on purpose — which models exist is a property of the user's machine,
  // and inventing one would be a fabricated claim about somebody else's disk.
  throw new BadRequestError(`${PROVIDER_MODEL_HEADER}: this provider has no default model — name one`);
}

function resolveSurface(
  req: Request,
  entry: ProviderEntry,
  modelId: string,
  body: ProviderSelectionBody | undefined,
): ModelSurface | null {
  const requested = body?.surface ?? readSurfaceHeader(req);
  if (requested) return requested;
  return findProviderModel(entry, modelId)?.surface ?? null;
}

function resolveBaseUrl(req: Request, entry: ProviderEntry, body: ProviderSelectionBody | undefined): string | null {
  if (entry.auth.kind !== "baseUrl") return null;
  const requested = body?.baseUrl ?? readBaseUrlHeader(req) ?? entry.auth.defaultBaseUrl;
  // Validated on the PARSED url before any fetch is issued — see requireLoopbackBaseUrl for the
  // SSRF reasoning. The default is validated too: a constant that stopped being loopback would
  // otherwise be the one path that skips the gate.
  return requireLoopbackBaseUrl(requested);
}

/**
 * Everything a planner run needs, resolved and validated.
 *
 * Throws `BadRequestError` (400) for a malformed selection and `HttpError` (402) for a missing
 * credential; `withAuth` renders both verbatim, so a route just calls this and uses the result.
 */
export function resolveProviderRun(
  req: Request,
  requestedEffort: unknown,
  body?: ProviderSelectionBody,
): ProviderRun {
  const entry = resolveEntry(req, body);
  const model = resolveModelId(req, entry, body);
  const selection: ModelSelection = {
    providerId: entry.id,
    model,
    surface: resolveSurface(req, entry, model, body),
    baseUrl: resolveBaseUrl(req, entry, body),
  };

  const credential = resolveProviderKey(req, entry.auth);
  if (credential.kind === "none" && entry.auth.kind === "apiKey") {
    throw new HttpError(402, NO_KEY_MESSAGE);
  }

  const capabilities = capabilitiesFor(entry, findProviderModel(entry, selection.model, selection.surface));
  return { entry, selection, capabilities, credential, effort: effortProfileFor(requestedEffort, capabilities) };
}
