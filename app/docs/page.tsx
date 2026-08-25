/**
 * app/docs/page.tsx — the technical blueprint, at /docs.
 *
 * WHAT THIS PAGE IS FOR. The landing page sells the idea; this one describes the machine, in enough
 * detail that a stranger can decide whether to trust it, extend it, or fork it without reading the
 * whole tree first. Everything here was read out of the code it describes. Where the code does less
 * than the name suggests, that is stated here rather than left for the reader to discover.
 *
 * WHY IT IS ONE FILE. It is a spec, not an app: no state, no client JS, one server-rendered
 * document with a table of contents. Splitting it into MDX would buy a build pipeline and lose the
 * ability to interpolate a constant straight out of the code (see RENDERABLE_ENTRY_COUNT below).
 *
 * KEEPING IT TRUE. `lib/seo/honesty.test.ts` renders this route and scans it with the property's
 * banned-phrase lint, so the same rules that bind the landing bind the docs.
 */
import { breadcrumbNode, graph, organizationNode, websiteNode } from "@/lib/seo/jsonld";
import { REPO_URL } from "@/lib/site/primaryCta";
import { RENDERABLE_ENTRY_COUNT } from "@/lib/landing/catalog";
import { TICKS_PER_SECOND } from "@/lib/edl/time";
import { SLOGAN } from "../_landing/copy";

const DOCS_GRAPH = graph(
  organizationNode(),
  websiteNode(),
  breadcrumbNode([
    { name: "Home", path: "/" },
    { name: "Docs", path: "/docs" },
  ]),
);

const SECTIONS = [
  { id: "overview", title: "What Hite is" },
  { id: "spine", title: "The spine" },
  { id: "timeline", title: "The timeline: EDL.2" },
  { id: "commands", title: "The command union" },
  { id: "reducer", title: "The reducer" },
  { id: "time", title: "Time, frames and determinism" },
  { id: "history", title: "History and undo" },
  { id: "render-ir", title: "The render IR" },
  { id: "renderer", title: "One renderer" },
  { id: "planner", title: "The planner" },
  { id: "tools", title: "The tool library and the router" },
  { id: "flat-schema", title: "The flat schema" },
  { id: "providers", title: "Models and keys" },
  { id: "renderable", title: "The renderable gate" },
  { id: "jobs", title: "Jobs, the worker and analysis" },
  { id: "data", title: "Data model, storage and RLS" },
  { id: "running", title: "Running it" },
  { id: "extending", title: "Extending it" },
  { id: "limits", title: "What is not there yet" },
] as const;

/** The 15 commands the model may emit. Read from `lib/edl/commands.ts`. */
const AI_COMMANDS = [
  ["ADD_CLIP", "assetId, trackId, atTick, inTick, outTick", "Place a clip. Refused unless outTick > inTick."],
  ["REMOVE_CLIP", "clipId, ripple = true", "Delete a clip, closing the hole behind it by default."],
  ["MOVE_CLIP", "clipId, toTrackId, atTick", "Reposition a clip."],
  ["SPLIT_CLIP", "clipId, atTick", "Cut in two. The left half keeps the parent id."],
  ["TRIM_CLIP", "clipId, edge, toTick", "Move an in or out point."],
  ["SET_CLIP_SPEED", "clipId, speed", "Retime. Clamped to 0.1–100 by the reducer."],
  ["PROPOSE_CUTS", "clips[], rationale?", "Replace the whole main track in one move."],
  ["ADD_EFFECT", "target, effectKey, params, window?", "Attach a registry effect over a range."],
  ["ADD_TRANSITION", "betweenClipIds, transitionKey, durationTicks, params", "Treat one boundary between two adjacent clips."],
  ["ADD_OVERLAY", "overlayKey, window, placement, params", "Composite an overlay, optionally anchored."],
  ["COMPOSE_LOOK", "lookKey, targetClipIds?", "Apply a recipe that fans out into effects and overlays."],
  ["ADD_CAPTION", "window, text, style", "Add a caption segment."],
  ["ADD_AUDIO_BED", "assetId, window, volume, loop", "Lay a music or ambience bed."],
  ["ADD_MARKER", "atTick, title, color, kind", "Mark a moment."],
  ["SET_OUTPUT_VARIANT", "aspect, maxTicks?", "Choose the output aspect."],
] as const;

/** The 9 the editor dispatches but the model never sees. */
const UI_COMMANDS = [
  "SET_CLIP_VOLUME",
  "REMOVE_EFFECT",
  "REMOVE_TRANSITION",
  "REMOVE_OVERLAY",
  "REMOVE_CAPTION",
  "REMOVE_AUDIO_BED",
  "CLEAR_LOOKS",
  "SET_CAPTION_STYLE",
  "ADJUST_WORD_TIMING",
] as const;

const TOOLS = [
  ["searchRegistry", "registry", "Resolve exact effect, look, overlay, transition and caption keys before emitting one."],
  ["browseRegistry", "registry", "List what exists in a category."],
  ["analyzeTranscript", "speech", "Read the transcript for a clip."],
  ["findSilences", "speech", "Leading, trailing and mid-clip dead air, from transcript gaps."],
  ["findFillerWords", "speech", "Locate ums, uhs and verbal tics."],
  ["analyzeBeats", "rhythm", "Tempo and beat positions from the audio."],
  ["planBeatCuts", "rhythm", "Propose cut points on the grid."],
  ["analyzeScenes", "structure", "Shot boundaries detected from the video."],
  ["planSceneCuts", "structure", "Turn shot boundaries into a cut plan."],
  ["findHighlights", "structure", "Pick the strongest stretches."],
  ["detectFaces", "vision", "Face tracks. Offered, but the analysis branch behind it is cut, so it reports none."],
  ["suggestOverlay", "vision", "Choose an overlay and a placement."],
  ["suggestColorGrade", "color", "Choose a grade from the catalog."],
  ["suggestLook", "color", "Choose a composed look recipe."],
  ["suggestAudioFx", "audio", "Choose an audio treatment."],
  ["suggestCaptionStyle", "text", "Choose a caption style."],
  ["suggestTransition", "motion", "Choose a transition that the renderer can actually paint."],
  ["suggestMotionFx", "motion", "Choose a speed, zoom or glitch treatment."],
  ["suggestPacing", "planning", "Propose a pace for a range."],
  ["planCutDown", "planning", "Plan a shorter version of a sequence."],
  ["planReframe", "planning", "Plan a reframe for another aspect."],
] as const;

export default function DocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: DOCS_GRAPH }} />
      <div className="doc-shell">
        <nav className="doc-toc" aria-label="On this page">
          <h2>On this page</h2>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <main className="doc-body">
          <p className="l3d-kicker">Technical blueprint</p>
          <h1>How Hite works</h1>
          <p className="doc-lede">
            {SLOGAN}, described as it is built. Every claim on this page was read out of the code it describes, and where
            the code does less than a name suggests, this page says so. If you are deciding whether to trust, extend or
            fork it, start here rather than with the source tree.
          </p>

          {/* ── 1 ─────────────────────────────────────────────────────────────────────────── */}
          <section id="overview" className="doc-section">
            <h2>What Hite is</h2>
            <p>
              Hite is a video editor with two doors into the same timeline. You can move a clip by hand, or you can
              describe the change in plain language and a model does it. Both routes emit the same typed commands, run
              through the same pure reducer, and land in the same edit decision list. There is no separate AI mode and
              no second data path.
            </p>
            <p>
              The model never touches pixels and never generates footage. It calls analysis and advisory tools against
              your media, then emits a batch of edit commands. What comes back is an ordinary timeline you can keep
              editing by hand, and every AI turn sits on the same undo stack as your own edits.
            </p>
            <div className="doc-note">
              <h4>The shape of the repository</h4>
              <p>
                Next.js App Router, React and TypeScript in strict mode, Supabase for Postgres and object storage,
                Remotion for rendering, ffmpeg for decode, probe and analysis. One extra long-lived process, the worker,
                drains a Postgres job queue for analysis and export. It is MIT licensed;{" "}
                <a href={REPO_URL} rel="noreferrer">
                  the repository
                </a>{" "}
                has the quickstart.
              </p>
            </div>
          </section>

          {/* ── 2 ─────────────────────────────────────────────────────────────────────────── */}
          <section id="spine" className="doc-section">
            <h2>The spine</h2>
            <p>
              Five modules in a line. Everything else in the codebase is a leaf hanging off one of them, and the
              layering is the main thing a contributor is asked not to break.
            </p>
            <div className="doc-flow" role="figure" aria-label="The edit pipeline, in order">
              <span>EditCommand[]</span>
              <i>→</i>
              <span>reduceBatch()</span>
              <i>→</i>
              <span>Edl.2</span>
              <i>→</i>
              <span>edlToRenderIR()</span>
              <i>→</i>
              <span>HiteRoot</span>
            </div>
            <p>
              A command is a typed intent. The reducer is a pure function that applies a whole batch as one transaction.
              The EDL is the single source of truth for what the video is. The compiler turns that into a render IR, a
              frame-space description with content hashes. The Remotion composition paints the IR, in the browser for
              preview and in the worker for export.
            </p>
            <p>
              The rule that keeps this honest: <code>edlToRenderIR</code> is imported by both the preview and the export,
              never reimplemented. Preview and export disagreeing is a class of bug this architecture removes rather than
              fixes.
            </p>
          </section>

          {/* ── 3 ─────────────────────────────────────────────────────────────────────────── */}
          <section id="timeline" className="doc-section">
            <h2>The timeline: EDL.2</h2>
            <p>
              The edit decision list is a Zod schema tagged <code>Edl.2</code>, with every node carrying its own version
              tag (<code>Clip.1</code>, <code>Track.1</code>, and so on) so a single node can be migrated without a whole
              schema bump.
            </p>
            <div className="doc-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>What it holds</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>timebase</code></td>
                    <td>Ticks per second. {TICKS_PER_SECOND.toLocaleString("en-GB")} by default.</td>
                  </tr>
                  <tr>
                    <td><code>tracks</code></td>
                    <td>
                      Flat, OTIO-style. Each track is an ordered list of clips and gaps, strictly sequential and
                      non-overlapping. A clip has no stored start time: its position is derived from the items before it.
                    </td>
                  </tr>
                  <tr>
                    <td><code>transitions</code></td>
                    <td>A treatment on one boundary between two adjacent clips, with a duration and parameters.</td>
                  </tr>
                  <tr>
                    <td><code>overlays</code>, <code>captions</code>, <code>audioBeds</code>, <code>markers</code></td>
                    <td>Timeline-absolute windows, kept beside the tracks rather than inside them.</td>
                  </tr>
                  <tr>
                    <td><code>looksApplied</code></td>
                    <td>Recipes that fan out into effects and overlays at compile time.</td>
                  </tr>
                  <tr>
                    <td><code>outputs</code></td>
                    <td>Aspect variants: 16:9, 9:16 or 1:1.</td>
                  </tr>
                  <tr>
                    <td><code>revision</code>, <code>contentHash</code></td>
                    <td>
                      Revision counts applied batches and orders the command log. The content hash is computed over the
                      EDL with both the hash and the revision excluded, so two byte-identical timelines reached by
                      different edit paths share a hash.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Effect windows are absolute timeline ticks, not clip-relative. Volume keyframes are the exception and are
              node-relative; the compiler is the single place that crossing happens.
            </p>
          </section>

          {/* ── 4 ─────────────────────────────────────────────────────────────────────────── */}
          <section id="commands" className="doc-section">
            <h2>The command union</h2>
            <p>
              Twenty-four variants in two groups. Fifteen the model may emit, nine the editor dispatches but the model
              never sees. A batch is at most forty commands with a required summary, which is one turn&apos;s worth of
              edits rather than a provider limit.
            </p>
            <h3>Emitted by the model</h3>
            <div className="doc-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>Fields</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {AI_COMMANDS.map(([name, fields, meaning]) => (
                    <tr key={name}>
                      <td><code>{name}</code></td>
                      <td><code>{fields}</code></td>
                      <td>{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Editor only</h3>
            <p>
              {UI_COMMANDS.map((c, i) => (
                <span key={c}>
                  <code>{c}</code>
                  {i < UI_COMMANDS.length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
            <p>
              Each applied command is wrapped in an envelope for the audit log: a ULID, a batch id, a monotonic sequence
              number unique per session, the source (<code>ai</code>, <code>user</code> or <code>seed</code>), and an
              optional rationale. That ULID is the only randomness in the system, and it is minted at the boundary so
              nothing inside the reducer is non-deterministic.
            </p>
          </section>

          {/* ── 5 ─────────────────────────────────────────────────────────────────────────── */}
          <section id="reducer" className="doc-section">
            <h2>The reducer</h2>
            <p>
              <code>reduceBatch(edl, commands, options)</code> returns a new EDL plus forward and inverse patches. It
              performs no I/O, reads no registry and consults no clock. That is enforced by a lint rule, not by
              convention: <code>Math.random</code>, <code>Date.now</code>, <code>crypto.randomUUID</code>, a bare{" "}
              <code>new Date()</code> and <code>setInterval</code> are all banned inside the reducer, the compiler and
              the composition.
            </p>
            <p>A batch is one transaction, in this order:</p>
            <ol className="doc-list">
              <li>Every command is applied in array order to a single draft.</li>
              <li>Each track is normalised: adjacent gaps merge, zero-length gaps are dropped, trailing gaps are removed.</li>
              <li>
                Transitions are pruned if either clip vanished or the two are no longer strictly adjacent, and clamped
                (not dropped) if longer than the shorter neighbour.
              </li>
              <li>The duration is recomputed from the longest track and the furthest overlay, caption or bed.</li>
              <li>The revision is bumped, then the whole result is re-parsed against the schema as a tripwire.</li>
              <li>Range sanity and clip-id uniqueness are asserted, then the content hash is recomputed.</li>
            </ol>
            <p>
              Anything that throws escapes the draft, so the batch rolls back whole. Errors are typed and named:{" "}
              <code>trim_collapses_clip</code>, <code>transition_not_adjacent</code>, <code>clip_exceeds_media</code>,{" "}
              <code>degenerate_window</code>, and a dozen more. The editor shows the message verbatim rather than a
              generic failure.
            </p>
            <div className="doc-note">
              <h4>A no-op is an error</h4>
              <p>
                A trim clamped into a hard bound that changes nothing throws rather than succeeding silently. A command
                that reports success while leaving the video identical is the failure mode this codebase works hardest to
                avoid, and it is the same instinct behind the renderable gate below.
              </p>
            </div>
            <p>
              Removals are deliberately asymmetric. Removing a clip or an effect by an unknown id throws, because the
              caller has lost track of the timeline. Removing a transition, overlay, caption or bed that is already gone
              is a no-op, because those are decorations and a repeated delete should be safe.
            </p>
            <p>
              Identifiers are content-addressed rather than random. Effects, overlays, looks, transitions, captions, beds
              and markers get a hash of their own content; clips get a hash of their lineage. Reseeding an id therefore
              never busts the render cache, and identical subtrees deduplicate.
            </p>
          </section>

          {/* ── 6 ─────────────────────────────────────────────────────────────────────────── */}
          <section id="time" className="doc-section">
            <h2>Time, frames and determinism</h2>
            <p>
              Time is an integer count of ticks at {TICKS_PER_SECOND.toLocaleString("en-GB")} per second. No float ever
              enters the EDL, the render IR or a hash. That rate is frame-exact at 24, 25, 30, 50 and 60 frames per
              second and also millisecond-exact, so ticks convert to frames by exact integer division at every supported
              rate.
            </p>
            <p>
              There is exactly one ticks-to-frames conversion in the codebase, and it lives in the compiler. For the
              degenerate case of a frame rate that does not divide the tick rate it rounds half to even, so a frame
              boundary is identical on every machine — a hard requirement for content-addressed rendering.
            </p>
            <p>
              Frame rate is not stored in the EDL. It is resolved from the first clip whose asset reports a usable rate,
              defaulting to 30. That resolution lives in one file specifically because a preview and an export
              disagreeing about frame rate is otherwise very easy to reintroduce.
            </p>
          </section>

          {/* ── 7 ─────────────────────────────────────────────────────────────────────────── */}
          <section id="history" className="doc-section">
            <h2>History and undo</h2>
            <p>
              Two things are recorded per edit: the semantic command batch, for the audit log and for replay from a seed,
              and the inverse patches, which are what undo actually applies. Synthesising a precise inverse command for
              every operation would be strictly more fragile.
            </p>
            <p>
              A drag coalesces: successive commands carrying the same key amend the top entry rather than stacking, so
              one undo reverts the whole gesture. An AI turn arrives as a snapshot — the server already reduced and
              persisted, so the client records the diff to that exact EDL rather than re-running the reducer and risking
              a different result.
            </p>
            <p>
              Both routes push onto one stack held by one controller. That is the whole mechanism behind undoing an AI
              edit: there is nothing special about it to undo.
            </p>
          </section>

          {/* ── 8 ─────────────────────────────────────────────────────────────────────────── */}
          <section id="render-ir" className="doc-section">
            <h2>The render IR</h2>
            <p>
              <code>edlToRenderIR(edl, env, resolver)</code> is synchronous and pure given its three arguments. Signing
              URLs and reading the database happen at the boundary and arrive through the resolver, which is what lets
              the same function run in a browser and in a worker.
            </p>
            <p>
              The IR materialises exactly one frame space: absolute timeline frames. A stack of track nodes, each holding
              clips, gaps, transitions, overlays, captions and audio, every one carrying both its tick and its frame
              form. Nodes are hashed bottom-up with SHA-256 over a stable stringification, with identity fields excluded
              by construction so that identity and cache key stay orthogonal.
            </p>
            <p>
              Resolution is a function of aspect and quality rather than a preset table:
            </p>
            <div className="doc-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Aspect</th>
                    <th>Full</th>
                    <th>Proxy</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>16:9</td><td>1920 × 1080</td><td>960 × 540</td></tr>
                  <tr><td>9:16</td><td>1080 × 1920</td><td>540 × 960</td></tr>
                  <tr><td>1:1</td><td>1080 × 1080</td><td>540 × 540</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              Exports are H.264 in an MP4 container, always at full quality. When the compiler cannot honour something —
              a look recipe step whose variable was never supplied — it drops that step and records a diagnostic rather
              than substituting a zero. Diagnostics deliberately do not affect the hash.
            </p>
            <div className="doc-note" data-kind="warn">
              <h4>Designed for a segment cache that does not exist yet</h4>
              <p>
                The IR is hashed per node and a segment key is defined, but nothing in the production path calls it. Hite
                does not currently cache rendered segments. The groundwork is there; the cache is not.
              </p>
            </div>
          </section>

          {/* ── 9 ─────────────────────────────────────────────────────────────────────────── */}
          <section id="renderer" className="doc-section">
            <h2>One renderer</h2>
            <p>
              A single Remotion composition paints the IR. The browser preview mounts it in a player; the worker selects
              the same composition by id and renders it to a file. Both compile the IR with the same function and the
              same resolver, differing only in an engine fingerprint string.
            </p>
            <p>
              Each clip becomes a sequence containing a video or image, wrapped by whichever effect renderers are
              registered for it. Registration, not engine type, is the gate: an effect with no renderer is skipped rather
              than faked. Transitions paint in a second pass on top of the clips so the treatment covers both sides of
              the cut.
            </p>
          </section>

          {/* ── 10 ────────────────────────────────────────────────────────────────────────── */}
          <section id="planner" className="doc-section">
            <h2>The planner</h2>
            <p>
              A turn is a tool loop with a grounding phase, a terminal emit, and — above the lowest effort setting — a
              critique round in which the model is shown what its own batch actually did and given the chance to revise
              it.
            </p>
            <h3>Grounding first</h3>
            <p>
              For the first few steps the emit tool is withheld and a tool call is required. That constraint is
              load-bearing rather than stylistic: the loop only continues after a step that made a call, so a grounding
              step answered with prose would end the turn with no batch at all. The effect is that a plan is built on
              what the tools actually returned, not on what the request implied.
            </p>
            <h3>The critique round</h3>
            <p>
              The emit tool does not simply accept the batch. It runs it through the real reducer in process — no
              database, no network — and hands back the resulting timeline, a description of each command as applied,
              the before and after durations and clip counts, and a set of server-measured checks. Those checks are
              blunt on purpose:
            </p>
            <ul>
              <li>the batch changed nothing at all, by content hash;</li>
              <li>the timeline now has no clips;</li>
              <li>a requested length versus the length actually produced, as a percentage over or under;</li>
              <li>a transition the reducer silently dropped or shortened because the clips were not adjacent;</li>
              <li>how many clips a grade actually reached.</li>
            </ul>
            <p>
              The model either revises or confirms by re-emitting the same batch, and confirmation is tracked by content
              hash so a reworded repeat is not mistaken for agreement. A batch the reducer rejected always gets a repair
              round. This is the largest quality lever in the layer, because the feedback is measured rather than
              imagined.
            </p>
            <h3>Effort</h3>
            <p>
              Four settings, chosen per request, controlling reasoning budget, step count, revision rounds, grounding
              steps and a wall-clock ceiling. The highest rung is bounded by wall clock rather than by steps, so a
              slow-thinking model gets fewer critique rounds, not more. The ceiling is also derived from what the
              provider can actually do: a provider that cannot be forced to call a tool cannot be trusted with the
              grounding phase, so its effort is capped rather than silently ignored. Deployers can cap it further.
            </p>
            <h3>Everything is visible</h3>
            <p>
              The turn streams as events: the tool name, its arguments and its result; warnings; the resulting EDL; a
              summary; the saved edit. The editor renders the real tool names and counts read off the tools&apos; own
              returned arrays. A plan built on an empty transcript looks different from one built on a real one, because
              tools that find nothing say so explicitly rather than returning a bare empty list that reads like a clean
              bill of health.
            </p>
            <div className="doc-note">
              <h4>Tool results are data, not instructions</h4>
              <p>
                The system prompt states it outright: transcript lines, filenames and tool results are content to reason
                over, never commands to follow. It also forbids asserting any fact about the video that no tool
                returned, and reminds the model that an empty result is not proof of absence.
              </p>
            </div>
          </section>

          {/* ── 11 ────────────────────────────────────────────────────────────────────────── */}
          <section id="tools" className="doc-section">
            <h2>The tool library and the router</h2>
            <p>
              Twenty-one tools, each in one file, each declaring a capability tier and a line about when to reach for it.
              Model tool-selection accuracy degrades once too many tools are in play, so the router exposes only the
              tiers a request actually touches, keeping any single turn under that ceiling.
            </p>
            <div className="doc-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Tier</th>
                    <th>What it does</th>
                  </tr>
                </thead>
                <tbody>
                  {TOOLS.map(([name, tier, what]) => (
                    <tr key={name}>
                      <td><code>{name}</code></td>
                      <td>{tier}</td>
                      <td>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Tiers are matched from the request by keyword stems, written as stems rather than whole words so that
              &quot;caption&quot; also catches captions and captioning. A compound request keeps every tier it touches
              rather than the strongest one. A request that matches no tier at all falls back to the tiers that a vague
              ask ever turns out to mean: trim it, or restyle it.
            </p>
          </section>

          {/* ── 12 ────────────────────────────────────────────────────────────────────────── */}
          <section id="flat-schema" className="doc-section">
            <h2>The flat schema</h2>
            <p>
              The command union uses tuples, records and unions, all of which some providers&apos; function-calling
              layers reject outright. So the model is not handed that union. It emits a deliberately flat, shallow
              schema — strings, numbers, booleans and enums, nothing nested — which is then mapped onto the real command
              union before it reaches the reducer.
            </p>
            <p>
              This is the ceiling on what a model can express in one turn, and it is a real one: an expressiveness limit
              in the flat schema is felt as the model being unable to ask for something the editor can do by hand.
              Widening it is the single highest-leverage change for output quality, and it costs compatibility with the
              strictest providers.
            </p>
          </section>

          {/* ── 13 ────────────────────────────────────────────────────────────────────────── */}
          <section id="providers" className="doc-section">
            <h2>Models and keys</h2>
            <p>
              Hite is bring-your-own-key. The key travels on the request, is used for that request, and is never pooled
              on a server you do not control. A request without a key is refused rather than quietly routed somewhere
              else. Self-hosted OpenAI-compatible endpoints are first-class, so a local model is a supported
              configuration rather than an afterthought.
            </p>
            <p>
              The provider registry is data and imports no vendor SDK, which is what keeps the browser bundle free of
              them; one module does the dynamic import for whichever provider a request actually names.
            </p>
            <p>
              Eight providers ship with the registry: Google, OpenAI, Anthropic, Groq, xAI, DeepSeek, OpenRouter, and a
              self-hosted OpenAI-compatible endpoint. Reasoning effort is normalised to five intents and translated per
              provider from that provider&apos;s own published option shape; an intent a provider cannot express is
              dropped rather than approximated with something nearby.
            </p>
            <p>
              The key is treated as hostile-adjacent data throughout: header only, never a body or a query string,
              validated by length and character class rather than by a format guess, and redacted from every
              user-visible string in both raw and percent-encoded form. That redaction exists because a provider&apos;s
              own error body for an invalid key can contain the key, and the SDK&apos;s default error logger prints the
              whole body.
            </p>
            <div className="doc-note" data-kind="warn">
              <h4>Verified means measured, and nothing is measured yet</h4>
              <p>
                Provider badges are derived from a file that only the verification harness writes, and that file is
                currently empty. Every provider and every model, Google included, therefore badges as untested. That is
                the honest state: the harness exists, runs real prompts and grades them with the same deterministic code
                the product uses, but it has not been run. Until it has, no claim about which model suits Hite best is
                evidence, including a claim made by us.
              </p>
            </div>
          </section>

          {/* ── 14 ────────────────────────────────────────────────────────────────────────── */}
          <section id="renderable" className="doc-section">
            <h2>The renderable gate</h2>
            <p>
              The effect catalog advertises more than the renderer can paint. Rather than let a model emit a key that
              quietly does nothing, everything model-facing is filtered through one gate that asks whether this build can
              actually render that entry, and anything withheld comes back with the reason attached.
            </p>
            <p>
              This is why the numbers on this property are lower than the catalog size, and why they differ from each
              other: what the renderer can paint and what the landing catalog lists are two different questions with two
              different answers. The catalog section shows {RENDERABLE_ENTRY_COUNT}, scoped to the categories it covers.
            </p>
            <p>
              The most visible consequence: transitions that need two clips&apos; pixels blended together are withheld.
              What ships is a set of boundary treatments — a dip through black, a flash, a burn, a chromatic cut, a whip
              — which are faithful to their names. A cross dissolve is not among them, because v1 cannot blend two
              clips, and calling a dip to black a cross dissolve would be a lie told by the software rather than by a
              person.
            </p>
            <p>
              Colour LUTs render as filter approximations rather than true 3D-LUT sampling, and this page says so for
              the same reason.
            </p>
          </section>

          {/* ── 15 ────────────────────────────────────────────────────────────────────────── */}
          <section id="jobs" className="doc-section">
            <h2>Jobs, the worker and analysis</h2>
            <p>
              Analysis and export are queued in Postgres and drained by a second process. It is a real queue, not a
              convention: claiming a job is a single statement that locks a row and skips ones already taken, so two
              workers never collide.
            </p>
            <h3>What the worker guarantees</h3>
            <ul>
              <li>
                <strong>Heartbeats and a reaper.</strong> A worker that dies has its jobs requeued after a stale window,
                and the reaper runs once at boot as well as on a timer.
              </li>
              <li>
                <strong>A per-job deadline.</strong> A wedged handler heartbeats exactly as diligently as a working one,
                so the reaper alone can never catch it. Each job carries its own timeout and is abandoned when it
                expires.
              </li>
              <li>
                <strong>Fencing.</strong> Every terminal write is conditional on still holding the claim, so a worker
                that lost its job cannot overwrite the outcome of the worker that took it.
              </li>
              <li>
                <strong>Idempotency.</strong> Analysis rows upsert on asset and kind; an export overwrites a stable path.
                A repeated job is therefore safe, which is what makes requeueing safe.
              </li>
              <li>
                <strong>Graceful shutdown.</strong> On a signal it stops claiming, lets in-flight work finish, and
                releases anything unfinished back to the queue rather than leaving it to time out.
              </li>
              <li>
                <strong>One render at a time,</strong> because Chromium painting a 1080p composition is the heaviest
                thing the process does. Scale by running more workers, not by raising the number.
              </li>
            </ul>
            <h3>What analysis produces</h3>
            <p>
              Four things are computed and stored: a probe of the media, a transcript, a tempo and beat grid, and scene
              boundaries. Each branch persists as soon as it succeeds, and failures are collected and reported together,
              so one bad audio stream does not cost you the scene detection. A probe failure is not a branch — it fails
              the whole job, because everything downstream depends on knowing what the media is.
            </p>
            <p>
              Silence and filler words are <em>not</em> separate stages. They are derived from gaps and tokens in the
              transcript at the moment a tool asks for them. That has a consequence worth stating plainly: without a
              transcription key there is no transcript, and therefore no silence detection, so the request Hite is best
              known for cannot be served. The tools say that rather than returning an empty list.
            </p>
            <div className="doc-note" data-kind="limit">
              <h4>Faces are not wired</h4>
              <p>
                The face branch was cut because the implementation was Python-only. Nothing fabricates a face track: the
                resolver returns an empty one, the compiler drops the step that needed it and records a diagnostic.
                Anything that anchors to a person is therefore withheld rather than approximated.
              </p>
            </div>
          </section>

          {/* ── 16 ────────────────────────────────────────────────────────────────────────── */}
          <section id="data" className="doc-section">
            <h2>Data model, storage and RLS</h2>
            <p>
              Projects own assets and edits. Assets own transcripts and analyses. Edits own exports. Jobs point at an
              asset or an export, never both, enforced by a check constraint. One live analysis job per asset is
              enforced by a partial unique index, which removes duplicate work as a class rather than by convention.
            </p>
            <p>
              Row-level security is the boundary, and it is written as joins back to ownership rather than trusting an
              application layer. You can read a transcript only if its asset belongs to a project you own. Clients may
              read jobs and never write them: jobs are created by server routes after an ownership check, and the worker
              bypasses the policy entirely with a service role that never reaches a browser.
            </p>
            <p>
              Rate-limit and budget tables have row-level security enabled with no policies at all, which denies every
              client role. That is deliberate defence in depth against a leaked public key.
            </p>
            <p>
              Storage is three buckets: private media, private exports, and a public bucket for preview clips. Object
              policies key on the first path segment being your own user id, so a file at the bucket root is reachable by
              nobody, which is the intended default.
            </p>
            <h3>Sessions without accounts</h3>
            <p>
              There is no sign-in screen and nothing asks for an email. The first request to the editor mints an
              anonymous session, and row-level security scopes everything to it. The trade is worth stating plainly: that
              session lives in your browser&apos;s cookie and there is no account to recover it with, so a different
              browser starts you on an empty workbench. Export what you want to keep.
            </p>
          </section>

          {/* ── 17 ────────────────────────────────────────────────────────────────────────── */}
          <section id="running" className="doc-section">
            <h2>Running it</h2>
            <p>
              Two processes. The web app, and the worker that drains the queue. Without the second one, uploads and the
              editor work but every analysis and export sits queued.
            </p>
            <pre>
              <code>{`git clone ${REPO_URL}
cd hite
pnpm install

# the app
pnpm dev

# a second terminal: the queue drainer
pnpm worker`}</code>
            </pre>
            <p>
              A local Supabase stack supplies Postgres and storage; the migrations apply on start. Rendering needs a
              Chromium that Remotion can drive, and ffmpeg is vendored. The repository&apos;s readme carries the exact
              steps, including the two that reliably bite: the Supabase CLI&apos;s install is blocked by a build-script
              allowlist and needs one manual command, and this project&apos;s local ports are not the defaults.
            </p>
            <h3>Gates</h3>
            <p>
              <code>pnpm typecheck</code>, <code>pnpm lint</code> and <code>pnpm exec vitest run</code>. The integration
              suites need a local Supabase stack and skip without one; they cover the async backend against a real
              database, including a real render to a decodable file and a worker killed mid-render being reaped.
            </p>
          </section>

          {/* ── 18 ────────────────────────────────────────────────────────────────────────── */}
          <section id="extending" className="doc-section">
            <h2>Extending it</h2>
            <h3>A new tool</h3>
            <p>
              One file exporting a spec with a name, a tier, a line about when to use it, and the tool itself. Add it to
              the generated index. Nothing in the planner or the reducer changes. To make a phrase reach it, widen that
              tier&apos;s keywords rather than the fallback set, which is sized to sit just under the accuracy ceiling.
            </p>
            <h3>A new edit command</h3>
            <p>
              Four coordinated changes, and skipping one is the usual way this breaks: a variant in the command union, a
              case in the reducer, render support, and an entry in the flat mapper so a model can actually emit it.
            </p>
            <h3>A new effect</h3>
            <p>
              An entry in the catalog and a registered renderer. The build fails if a clip effect exists with no
              renderer behind it, which is the gate that stops the catalog drifting ahead of the picture again.
            </p>
          </section>

          {/* ── 19 ────────────────────────────────────────────────────────────────────────── */}
          <section id="limits" className="doc-section">
            <h2>What is not there yet</h2>
            <p>
              This section exists because a technical document that only lists strengths is not a technical document.
            </p>
            <ul>
              <li>
                <strong>No segment cache.</strong> The IR is hashed for one and the key is defined, but nothing calls it.
                Every export renders from scratch.
              </li>
              <li>
                <strong>No true cross dissolve.</strong> Transitions are boundary treatments; blending two clips&apos;
                pixels is not implemented, and the transitions that would need it are withheld from the model.
              </li>
              <li>
                <strong>No face tracking.</strong> Cut for being Python-only. Face-anchored placement degrades visibly
                and records a diagnostic instead of guessing.
              </li>
              <li>
                <strong>LUTs are approximations.</strong> Filter-based, not 3D-LUT sampling.
              </li>
              <li>
                <strong>One export format.</strong> 1080p H.264 in an MP4, at the encoder&apos;s defaults. No bitrate or
                codec controls are exposed.
              </li>
              <li>
                <strong>Transition length does not shorten the timeline.</strong> Clips are laid strictly end to end and
                a transition treats the boundary; the offsets are computed for the future work and currently unused.
              </li>
              <li>
                <strong>The flat schema bounds the model.</strong> Anything it cannot express, the model cannot ask for,
                however capable the model is. In particular the vocabulary is additive: there is no command to weaken,
                retune or remove an effect that a previous turn added.
              </li>
              <li>
                <strong>A turn has no memory.</strong> A refinement is sent with the current timeline and the new
                request, not with the conversation. Multi-turn reasoning is structurally unavailable.
              </li>
              <li>
                <strong>The model cannot see the picture.</strong> There is deliberately no frame-sampling tool: an
                earlier one passed a URL as text and returned the model&apos;s guess as though it were an observation,
                which is worse than nothing. Real vision needs real frames, and that work has not been done.
              </li>
              <li>
                <strong>No model has been measured.</strong> The verification harness has never been run, so every
                provider badge reads untested and no ranking of models exists.
              </li>
            </ul>
            <p>
              Every one of these is visible in the code with the reason attached. If you are evaluating Hite, these are
              the things to weigh; if you are contributing, they are the most valuable places to start.
            </p>
          </section>
        </main>
      </div>
    </>
  );
}
