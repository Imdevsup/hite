import type { EditCommand } from "@/lib/edl/commands";

/**
 * Human-readable, one-line description of an EditCommand — used for the AI change-diff in chat
 * and for undo-history labels. Pure (no "use client"): safe on both the server route and client.
 * Leverages the typed command architecture: every edit is a discrete, describable object.
 */
export function describeCommand(cmd: EditCommand): string {
  switch (cmd.type) {
    case "ADD_CLIP":
      return "Added a clip";
    case "REMOVE_CLIP":
      return cmd.ripple ? "Removed a clip (closed the gap)" : "Removed a clip";
    case "MOVE_CLIP":
      return "Moved a clip";
    case "SPLIT_CLIP":
      return "Split a clip";
    case "TRIM_CLIP":
      return `Trimmed clip ${cmd.edge === "in" ? "start" : "end"}`;
    case "SET_CLIP_SPEED":
      return `Set speed to ${cmd.speed}×`;
    case "SET_CLIP_VOLUME":
      return `Set volume to ${Math.round(cmd.volume * 100)}%`;
    case "PROPOSE_CUTS":
      return `Proposed a ${cmd.clips.length}-clip cut`;
    case "ADD_EFFECT":
      return `Added effect · ${cmd.effectKey}`;
    case "ADD_TRANSITION":
      return `Added ${cmd.transitionKey} transition`;
    case "ADD_OVERLAY":
      return `Added overlay · ${cmd.overlayKey}`;
    case "COMPOSE_LOOK":
      return `Applied look · ${cmd.lookKey}`;
    case "ADD_CAPTION":
      return `Added caption “${truncate(cmd.text, 28)}”`;
    case "ADD_AUDIO_BED":
      return "Added an audio bed";
    case "ADD_MARKER":
      return `Marker · ${cmd.title}`;
    case "SET_OUTPUT_VARIANT":
      return `Set aspect to ${cmd.aspect}`;
    case "REMOVE_EFFECT":
      return "Removed an effect";
    case "REMOVE_TRANSITION":
      return "Removed a transition";
    case "REMOVE_OVERLAY":
      return "Removed an overlay";
    case "REMOVE_CAPTION":
      return "Removed a caption";
    case "REMOVE_AUDIO_BED":
      return "Removed an audio bed";
    case "CLEAR_LOOKS":
      return "Cleared all looks";
    case "SET_CAPTION_STYLE":
      return "Restyled a caption";
    case "ADJUST_WORD_TIMING":
      return "Retimed a caption";
    default: {
      const _exhaustive: never = cmd;
      return String((_exhaustive as { type?: string })?.type ?? "Edit");
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
