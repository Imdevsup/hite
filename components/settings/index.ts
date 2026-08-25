/**
 * THE SETTINGS SURFACE — ART-DIRECTION §14.
 *
 * WHAT THE EDITOR MOUNTS
 *   <SettingsSheet open={…} onClose={…} />   the whole sheet, behind the editor's own
 *                                            Settings affordance (§13 focusable #2). It renders
 *                                            `ProviderPickerPanel` (§14.1–14.2) and `DataFlow`
 *                                            (§14.4), each reading GET /api/settings for itself.
 *
 * WHAT THE EDITOR ALSO NEEDS, AND SHOULD NOT REBUILD
 *   providerKeyHeaders()      spread into every AI request so a visitor's key reaches
 *                             `resolveProviderKey`. Header only — never a body, never a query
 *                             string. This is the ONLY exported reader of key material, and it
 *                             hands it straight to `fetch`.
 *   providerSelectionHeaders() the NON-secret half — which provider, model, surface and address.
 *                             It must travel with the key on every planner request: without it
 *                             `resolveProviderRun` falls back to its default provider and sends
 *                             one vendor's key to another.
 *   readProviderPreference()  the remembered provider/model/base-URL choice.
 *   hasProviderKey()          a boolean. The key itself is not obtainable outside providerKey.ts.
 *   subscribeProviderKey()    + getServerProviderKeySnapshot(), for useSyncExternalStore.
 *   readEffortPreference()    the rung to send as `effort` on /api/plan and /api/refine.
 *   <ProviderKeyField />      the same key control, for §14.3's 402 flow: when the first prompt
 *                             answers 402 the input transforms in place, and it must be this
 *                             field — the disclosure, the fingerprint and the never-display
 *                             contract are not worth reimplementing twice.
 *
 * Everything else in this directory is internal.
 */
export { SettingsSheet, type SettingsSheetProps } from "./SettingsSheet";
export { ProviderKeyField, type ProviderKeyFieldProps } from "./ProviderKeyField";
export {
  PROVIDER_KEY_HEADER,
  getServerProviderKeySnapshot,
  hasProviderKey,
  providerKeyHeaders,
  subscribeProviderKey,
} from "./providerKey";
export { providerSelectionHeaders, type ProviderSelectionHeaders } from "./providerHeaders";
export { readProviderPreference, type ProviderPreference } from "./providerPreference";
export {
  readEffortPreference,
  subscribeEffortPreference,
} from "./effortPreference";
export type { Effort, SettingsSnapshot } from "./types";
