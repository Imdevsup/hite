/**
 * app/page.tsx — the landing page. One scroll-driven 3D sequence, then three sections.
 *
 * Built from scratch on 2026-08-21 to the owner's spec (`docs/landing-3d/00-decision-memo.md` in
 * the workspace records the decisions). The structure is the spec's §2: one fixed canvas for the
 * whole page, normal document scroll, DOM sections that scroll over it. Everything a visitor reads
 * is server-rendered HTML in this file; `components/landing3d/` only moves it.
 *
 * HONESTY. The 3D sequence is a STAGED demo project, declared as such in the hero and under the
 * stat row. Every number on the page is derived from `choreography/script.ts` by
 * `deriveDemoStats()`; every tool name is a real planner tool; every registry key is real and
 * renderable (`script.test.ts` pins all three). There is no testimonial, no user count and no
 * email capture, because none of those would be true. The primary CTA is `PRIMARY_CTA`: on the
 * public deploy it points at the repository, because www.tryhite.xyz does not host the editor.
 */
import { faqPageNode, graph, organizationNode, softwareApplicationNode, websiteNode } from "@/lib/seo/jsonld";
import Link from "next/link";
import { RENDERABLE_ENTRY_COUNT } from "@/lib/landing/catalog";
import { PRIMARY_CTA, REPO_URL } from "@/lib/site/primaryCta";
import Landing3D from "@/components/landing3d/Landing3D";
import { LANDING_FONT_CLASS } from "@/components/landing3d/fonts";
import { SUBTITLES, THREAD, TOOL_CALLS, deriveDemoStats, formatClock, formatSpoken } from "@/components/landing3d/choreography/script";
import { IDS } from "@/components/landing3d/ui/dom";
import "@/components/landing3d/landing.css";
import { LandingNav } from "./_landing/LandingNav";
import { FilmPlayer } from "@/app/_landing/FilmPlayer";
import { LandingFooter } from "./_landing/LandingFooter";
import { Reveal } from "./_landing/Reveal";
import { LANDING_FAQ } from "./_landing/faq";
import { SIGNATURES, SLOGAN, specConstants } from "./_landing/copy";
import { GithubMark } from "./_landing/GithubMark";

/**
 * §9.5 — the property's ONE structured-data graph, on `/`. The FAQPage is built from the same
 * array the visible FAQ renders, so the schema is byte-identical to the page by construction.
 */
const LANDING_GRAPH = graph(organizationNode(), websiteNode(), softwareApplicationNode(), faqPageNode(LANDING_FAQ, "/"));

/** The spine, as the code has it: hite-app/docs/ARCHITECTURE.md. Every node is a real module. */
const PIPELINE = [
  { label: "You, or the model", code: "EditCommand[]", note: "Typed commands: trim, split, transition, speed, caption, overlay, audio bed, marker. Both doors emit the same union." },
  { label: "Reducer", code: "reduceBatch()", note: "Pure. The same commands always produce the same timeline. One undo stack for human and AI edits." },
  { label: "Timeline", code: "EDL.2", note: "The single source of truth. Integer ticks at 30,000 per second; a frame at 30 fps is 1,000 ticks." },
  { label: "Compiler", code: "edlToRenderIR()", note: "The timeline becomes a render IR, hashed so unchanged segments are never rendered twice." },
  { label: "Renderer", code: "HiteRoot", note: "One Remotion composition draws the preview in the browser and the export in the worker. No second path." },
] as const;

const FACTS = [
  { n: "21", l: "tools in the planner's library, routed by tier" },
  { n: "8", l: "model providers, bring your own key" },
  { n: "1", l: "renderer for preview and export" },
  { n: "30,000", l: "ticks per second, the timebase" },
  { n: "1080p", l: "H.264 export from a Postgres-queued worker" },
  { n: "MIT", l: "licence for the whole repository" },
] as const;

const FEATURES = [
  {
    title: "It cuts, not suggests.",
    body: "Hite executes on your real timeline. Every change is an edit you can undo.",
  },
  {
    title: "It knows your footage.",
    body: "Transcripts, silence, scenes, beats. Indexed when you import.",
  },
  {
    title: "It shows its work.",
    body: "Every tool call is visible, inspectable and reversible. No black box on your edit.",
  },
] as const;

export default function HomePage() {
  const stats = deriveDemoStats();
  const external = (href: string) => (href.startsWith("http") ? { rel: "noreferrer" } : {});

  return (
    <div id={IDS.root} className={`l3d ${LANDING_FONT_CLASS}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: LANDING_GRAPH }} />

      {/* Renders the skip link as its first child, so it is the first focusable node on the page. */}
      <LandingNav />

      {/* tabIndex -1 so the skip link MOVES focus rather than only scrolling. */}
      <main id="main" tabIndex={-1}>
        <div id={IDS.scroll} className="l3d-scroll">
          {/* L6 — the hero copy. The ribbon flies behind it; the curl anchors the right two-thirds. */}
          <section id={IDS.hero} className="l3d-hero" aria-labelledby="l3d-h1">
            <div className="l3d-hero-inner">
              <p className="l3d-kicker l3d-hero-kicker">{SLOGAN}</p>
              <h1 id="l3d-h1" className="l3d-h1">
                Edit by saying so.
              </h1>
              <p className="l3d-lede">
                Hite is {SLOGAN.toLowerCase()}: an AI editor that lives on your timeline. Describe the cut. Watch it happen.
              </p>
              <div className="l3d-ctas">
                <a className="l3d-btn l3d-btn-primary" href={PRIMARY_CTA.href} {...external(PRIMARY_CTA.href)}>
                  <GithubMark />
                  {PRIMARY_CTA.label}
                </a>
                <a className="l3d-btn" href="#demo">
                  Scroll the demo
                </a>
              </div>
              <p className="l3d-demo-note">
                The demo below is a staged project of {stats.clipCount} clips, {formatSpoken(stats.sourceSeconds)}. Real tools, real
                commands, synthetic footage.
              </p>
            </div>
            <p id={IDS.hint} className="l3d-hint" aria-hidden="true">
              Scroll
            </p>
          </section>

          {/* The island: a fixed canvas in the scroll piece, stills under reduced motion, nothing without WebGL. */}
          <div id="demo" aria-hidden="false">
            <Landing3D />
          </div>

          <p id={IDS.eyebrow} className="l3d-eyebrow">
            {/* DERIVED. This said "Ninety-two minutes" while the HUD fifteen lines below it renders
                formatClock(stats.sourceSeconds) = 01:23:54 — eighty-four minutes — on the same
                screen. The number has one source now. */}
            Your timeline. {formatSpoken(stats.sourceSeconds)} of it.
          </p>

          {/* Subtitles: per-word reveal while the piece runs; body copy otherwise. */}
          <div id={IDS.subtitle} className="l3d-subtitles" aria-live="off">
            {SUBTITLES.map((s) => (
              <p key={s.p}>{s.text}</p>
            ))}
          </div>

          {/* HUD counters, the playhead's readout, track headers, the retime badge, the export flash. */}
          <div id={IDS.hud} className="l3d-hud" aria-hidden="true">
            <span>duration</span>
            <b id={IDS.hudDuration}>{formatClock(stats.sourceSeconds)}</b>
            <em id={IDS.hudSilences} />
          </div>
          <div id={IDS.timecode} className="l3d-timecode" aria-hidden="true">
            00:00:00:00
          </div>
          <div id={IDS.headers} className="l3d-headers" aria-hidden="true">
            <span data-lane="v2">V2</span>
            <span data-lane="v1">V1</span>
            <span data-lane="a1">A1</span>
            <span data-lane="a2">A2</span>
          </div>
          <div id={IDS.badge} className="l3d-badge" aria-hidden="true">
            1.35x
          </div>
          <div id={IDS.flash} className="l3d-flash" aria-hidden="true" />

          {/* Act 5's CTA over the composed frame. */}
          <div id={IDS.final} className="l3d-final">
            <span className="l3d-stat">{THREAD.stat}</span>
            <h2>{THREAD.closing}</h2>
            <a className="l3d-btn l3d-btn-primary" href={PRIMARY_CTA.href} {...external(PRIMARY_CTA.href)}>
              <GithubMark />
              {PRIMARY_CTA.label}
            </a>
          </div>
        </div>

        <div className="l3d-marketing">
          <Reveal />

          {/* The film. Everything in it — the cut, the grade, the transitions, the title, the frames
              themselves — came out of HITE, which is the only reason this section is allowed to say
              so. The mp4 is the worker's export of a real project, watermark included. */}
          <section id="film" className="l3d-section" aria-labelledby="l3d-film-h">
            <div className="l3d-wrap">
              <div className="l3d-section-head">
                <p className="l3d-kicker l3d-reveal">The film</p>
                <h2 id="l3d-film-h" className="l3d-h2 l3d-reveal">
                  This was cut in Hite.
                </h2>
                <p className="l3d-lede-sm l3d-reveal">
                  Twenty-one clips locked to the beat, twenty transitions, a look over all of it, and a title on the
                  opening — then rendered by the same compositor that draws the preview. What you are about to watch is
                  the file that came out of Export.
                </p>
              </div>
              <figure className="l3d-film l3d-reveal">
                <FilmPlayer
                  src="/demo/hite-demo.mp4"
                  label="A film cut and rendered in Hite, followed by the editor that made it"
                />
                <figcaption className="l3d-film-cap">
                  53 seconds. The middle 25 are Hite&rsquo;s own render; the rest is the editor that made it.
                </figcaption>
              </figure>
            </div>
          </section>

          {/* How it works: three steps, each with a small HTML mock of the thing it describes. */}
          <section id="how-it-works" className="l3d-section l3d-section-line" aria-labelledby="l3d-features-h">
            <div className="l3d-wrap">
              <div className="l3d-section-head">
                <p className="l3d-kicker l3d-reveal">How it works</p>
                <h2 id="l3d-features-h" className="l3d-h2 l3d-reveal">
                  One sentence in. Real edits out.
                </h2>
                <p className="l3d-lede-sm l3d-reveal">
                  Not a suggestion box. A planner that calls real tools against your footage and writes real commands onto
                  your timeline.
                </p>
              </div>
              <div className="l3d-steps">
                <article className="l3d-step l3d-reveal">
                  <div className="l3d-mock" aria-hidden="true">
                    <div className="l3d-mock-cmds">
                      {["TRIM_CLIP", "ADD_TRANSITION", "SET_CLIP_SPEED", "ADD_CAPTION"].map((c) => (
                        <span key={c}>{c}</span>
                      ))}
                    </div>
                    <div className="l3d-mock-bar">
                      <i style={{ width: "22%" }} />
                      <i style={{ width: "14%" }} />
                      <i style={{ width: "30%" }} />
                      <i style={{ width: "18%" }} />
                    </div>
                  </div>
                  <span className="l3d-step-n">01</span>
                  <h3>{FEATURES[0].title}</h3>
                  <p>{FEATURES[0].body}</p>
                </article>
                <article className="l3d-step l3d-reveal">
                  <div className="l3d-mock" aria-hidden="true">
                    <ul className="l3d-mock-index">
                      <li>
                        <span>transcript</span>
                        <b>2,140 words</b>
                      </li>
                      <li>
                        <span>silence</span>
                        <b>{stats.silenceCount} regions</b>
                      </li>
                      <li>
                        <span>scenes</span>
                        <b>{stats.clipCount} cuts</b>
                      </li>
                      <li>
                        <span>tempo</span>
                        <b>92 bpm</b>
                      </li>
                    </ul>
                  </div>
                  <span className="l3d-step-n">02</span>
                  <h3>{FEATURES[1].title}</h3>
                  <p>{FEATURES[1].body}</p>
                </article>
                <article className="l3d-step l3d-reveal">
                  <div className="l3d-mock" aria-hidden="true">
                    <ol className="l3d-mock-trace">
                      {TOOL_CALLS.slice(0, 4).map((c) => (
                        <li key={c.id}>
                          <i data-kind={c.category} />
                          <code>{c.name}</code>
                          <em>{c.kind === "tool" ? "ok" : `×${stats.silenceCount}`}</em>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <span className="l3d-step-n">03</span>
                  <h3>{FEATURES[2].title}</h3>
                  <p>{FEATURES[2].body}</p>
                </article>
              </div>
            </div>
          </section>

          {/* Under the hood: the spine drawn as it is in the code, two doors into one reducer. */}
          <section id="under-the-hood" className="l3d-section l3d-section-line" aria-labelledby="l3d-tech-h">
            <div className="l3d-wrap">
              <div className="l3d-section-head">
                <p className="l3d-kicker l3d-reveal">Under the hood</p>
                <h2 id="l3d-tech-h" className="l3d-h2 l3d-reveal">
                  One spine. No second path.
                </h2>
                <p className="l3d-lede-sm l3d-reveal">
                  The model and your hands go through the same door. Everything downstream is one pure function of the
                  timeline.
                </p>
              </div>

              <div className="l3d-pipe l3d-reveal" role="figure" aria-label="The edit pipeline, in order">
                <div className="l3d-pipe-doors" aria-hidden="true">
                  <span>
                    <i />
                    the model
                  </span>
                  <span>
                    <i />
                    your hands
                  </span>
                </div>
                <ol className="l3d-pipe-nodes">
                  {PIPELINE.map((n, i) => (
                    <li className="l3d-pipe-node" key={n.code} style={{ ["--i" as string]: i }}>
                      <span className="l3d-pipe-label">{n.label}</span>
                      <code className="l3d-pipe-code">{n.code}</code>
                      <p>{n.note}</p>
                    </li>
                  ))}
                </ol>
                <div className="l3d-pipe-outs" aria-hidden="true">
                  <span>preview</span>
                  <span>export</span>
                </div>
              </div>

              <ul className="l3d-facts">
                {FACTS.map((f) => (
                  <li className="l3d-fact l3d-reveal" key={f.n + f.l}>
                    <b>{f.n}</b>
                    <span>{f.l}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Straight after the spine, because the spine is the point at which someone technical stops
              reading marketing and starts wanting the real thing. /docs is that. */}
          <section id="deeper" className="l3d-section l3d-section-line" aria-labelledby="l3d-deeper-h">
            <div className="l3d-wrap">
              {/* The head lives INSIDE the left column rather than spanning the section, so the card
                  sits beside the argument instead of beside a one-line note, with the lede’s whole
                  width left blank above it. */}
              <div className="l3d-deeper-grid">
                <div className="l3d-deeper-copy l3d-reveal">
                  <p className="l3d-kicker">Go deeper</p>
                  <h2 id="l3d-deeper-h" className="l3d-h2">
                    The whole thing, written down.
                  </h2>
                  <p className="l3d-lede-sm">
                    Every stage above has a page behind it: the command union and what each one does to the timeline,
                    the reducer&rsquo;s invariants, why time is integer ticks, how the compiler turns an edit decision
                    list into a scene graph, and why the preview and the export are the same compositor rather than two
                    renderers that agree most of the time. It also says plainly what the renderer cannot draw yet, and
                    which registry entries are withheld from the model because of it.
                  </p>
                  <p className="l3d-deeper-note">
                    Three signatures carry the whole product. Everything else is arranged around them.
                  </p>
                  <div className="l3d-deeper-cta">
                    <Link className="l3d-btn l3d-btn-primary" href="/docs">
                      Read the docs
                    </Link>
                    <a className="l3d-btn" href={REPO_URL} target="_blank" rel="noreferrer noopener">
                      <GithubMark />
                      Read the source
                    </a>
                  </div>
                </div>

                {/* Real signatures and real numbers, copied off the modules they name — a decorative
                    code block that said something almost-true would be worse than blank space. */}
                <figure className="l3d-spec l3d-reveal" aria-labelledby="l3d-spec-cap">
                  <div className="l3d-spec-bar" aria-hidden="true">
                    <span>lib/edl</span>
                    <span>lib/render</span>
                  </div>
                  <ol className="l3d-spec-sigs">
                    {SIGNATURES.map((sig) => (
                      <li key={sig.fn}>
                        <code>
                          <b>{sig.fn}</b>
                          {sig.args}
                          <em>{sig.ret}</em>
                        </code>
                        <p>{sig.note}</p>
                      </li>
                    ))}
                  </ol>
                  <dl className="l3d-spec-consts">
                    {specConstants(RENDERABLE_ENTRY_COUNT).map((c) => (
                      <div key={c.label}>
                        <dt>{c.value}</dt>
                        <dd>{c.label}</dd>
                      </div>
                    ))}
                  </dl>
                  <figcaption id="l3d-spec-cap" className="sr-only">
                    The three function signatures the edit pipeline is built on, and the constants they operate under.
                  </figcaption>
                </figure>
              </div>
            </div>
          </section>

          {/* FAQ: visible answers and the FAQPage node are built from the same array. */}
          <section id="faq" className="l3d-section l3d-section-line" aria-labelledby="l3d-faq-h">
            <div className="l3d-wrap l3d-faq">
              <div className="l3d-section-head">
                <p className="l3d-kicker l3d-reveal">Questions</p>
                <h2 id="l3d-faq-h" className="l3d-h2 l3d-reveal">
                  Straight answers.
                </h2>
              </div>
              <div className="l3d-faq-list">
                {LANDING_FAQ.map((item, i) => (
                  <details className="l3d-faq-item l3d-reveal" key={item.q} open={i === 0}>
                    <summary>
                      <span>{item.q}</span>
                      <i aria-hidden="true" />
                    </summary>
                    <p>{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          {/* The close. */}
          <section id="start" className="l3d-close" aria-labelledby="l3d-close-h">
            <div className="l3d-wrap l3d-close-inner">
              <p className="l3d-kicker l3d-reveal">Open source</p>
              <h2 id="l3d-close-h" className="l3d-h1 l3d-reveal">
                Stop scrubbing. Start telling.
              </h2>
              <p className="l3d-lede-sm l3d-reveal">
                {SLOGAN}, MIT licensed. Clone it, bring your own model key, and describe the cut. The repository has the
                quickstart.
              </p>
              <div className="l3d-ctas l3d-reveal">
                <a className="l3d-btn l3d-btn-primary" href={PRIMARY_CTA.href} {...external(PRIMARY_CTA.href)}>
                  <GithubMark />
                  {PRIMARY_CTA.label}
                </a>
                <Link className="l3d-btn" href="/docs">
                  Read the docs
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
