/**
 * Centralised selectors for HITE QA smoke tests.
 * Pattern borrowed from Altab's ANVIL suite — all selectors live in one
 * file so marker-renames don't ripple across every spec.
 */

// ————————————————— Landing —————————————————
export const LANDING_HEADLINE = "HITE";
export const LANDING_TAGLINE = "The workshop is open.";
export const LANDING_CTA = "ENTER THE WORKSHOP";

// ————————————————— Auth —————————————————
// There are no auth selectors. `/login` and `/verify` are deleted and nobody is ever asked for an
// email: `middleware.ts` mints an anonymous Supabase session on the first `/app` request. Entering
// the app is `qa/helpers/guest-auth.ts` → `enterAsGuest(page)`, which is now just a navigation.

// ————————————————— Workshop (project list) —————————————————
export const WORKSHOP_EMPTY = "Nothing on the workbench yet.";
export const NEW_PROJECT_BUTTON = "NEW PROJECT";

// ————————————————— Editor: the prompt-first FIRST screen (DESIGN-DIRECTION §8.1) —————————————————
// A project with no timeline opens on `PromptStage`, not the workspace: the composer, the
// machine-checked example prompts, a drop target, and one way through to the manual chrome.
export const PROMPT_STAGE_COMPOSER = 'textarea[aria-label="Describe the edit you want"]';
export const PROMPT_STAGE_ENTER_WORKSPACE = "Open the timeline and edit by hand";
/** First entry of `lib/landing/prompts.ts` — the one allowlist every example on the property reads. */
export const PROMPT_STAGE_EXAMPLE = "cut the dead air";

// ————————————————— Editor chrome (the workspace, one click past the prompt) —————————————————
export const TOPBAR_RESET = "RESET";
export const TOPBAR_HOW = "HOW";
export const TOPBAR_EXPORT = "EXPORT";
// NOTE: there is no StatusBar selector any more. §8.2 deleted the component and moved its two real
// signals into the TopBar (save state, engine health) and `EditorAlerts` (the failure sentences).

// Tool rail — five tiles plus the palette tile. §8.2 capped the old ten-tile floating dock at five;
// Color / Text / Overlays / Audio / Chat / Inspector are reached through the palette or the dock.
export const TOOL_RAIL_TILES = ["MEDIA", "EFFECTS", "LOOKS", "TRANSITIONS", "EXPORT"] as const;
export const TOOL_RAIL_ALL_TOOLS = "All tools and commands";
export const DOCK_TILE = (type: string) => `[aria-label="${type}"]`;

// Timeline
export const TIMELINE_LABEL = "TIMELINE";

// ————————————————— Chat (the dock's first tab, not a floating window) —————————————————
export const CHAT_EMPTY_HEADLINE = "Say the edit";
export const CHAT_COMPOSER = 'textarea[placeholder*="Describe the edit"]';
export const CHAT_SEND_BUTTON = '[aria-label="Send the edit"]';

// ————————————————— Media —————————————————
/** A fragment of the Media window dropzone's aria-label. Deliberately NOT "add a clip": the
 *  Preview's own empty state has an "ADD A CLIP" button, and the two would match each other. */
export const MEDIA_DROPZONE = "drop a file here";

// ————————————————— Export —————————————————
export const EXPORT_ASPECT_169 = '[title], button:has-text("16:9")';
export const EXPORT_RENDER = "RENDER";
