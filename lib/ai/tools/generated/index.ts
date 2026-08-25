import type { ToolSpec } from "../registry";
import { spec as browseRegistry } from "./browseRegistry";
import { spec as findFillerWords } from "./findFillerWords";
import { spec as findHighlights } from "./findHighlights";
import { spec as findSilences } from "./findSilences";
import { spec as planBeatCuts } from "./planBeatCuts";
import { spec as planCutDown } from "./planCutDown";
import { spec as planReframe } from "./planReframe";
import { spec as planSceneCuts } from "./planSceneCuts";
import { spec as suggestAudioFx } from "./suggestAudioFx";
import { spec as suggestCaptionStyle } from "./suggestCaptionStyle";
import { spec as suggestColorGrade } from "./suggestColorGrade";
import { spec as suggestLook } from "./suggestLook";
import { spec as suggestMotionFx } from "./suggestMotionFx";
import { spec as suggestOverlay } from "./suggestOverlay";
import { spec as suggestPacing } from "./suggestPacing";
import { spec as suggestTransition } from "./suggestTransition";

/** All workflow-built tools, registered into the planner's library (lib/ai/tools/registry.ts). */
export const GENERATED_TOOLS: ToolSpec[] = [
  browseRegistry,
  findFillerWords,
  findHighlights,
  findSilences,
  planBeatCuts,
  planCutDown,
  planReframe,
  planSceneCuts,
  suggestAudioFx,
  suggestCaptionStyle,
  suggestColorGrade,
  suggestLook,
  suggestMotionFx,
  suggestOverlay,
  suggestPacing,
  suggestTransition,
];
