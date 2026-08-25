/**
 * Remotion bundler entry point. `@remotion/bundler` webpacks this module (and its full import
 * graph: HiteRoot, the effect registry, fonts, remotion core) into a self-contained static bundle
 * that the sandbox renders against. Do NOT import this from app/route code — it is render-only.
 */
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
