/**
 * app/_landing/LandingFooter.tsx — the landing's footer, in the landing's own type.
 *
 * Same link set as the site-wide `SiteFooter` (`SITE_FOOTER_COLUMNS` is the one owner of those
 * links, and `app/page.test.tsx` gates that the homepage keeps reaching the marketing content
 * layer through them), rendered in the landing's system instead of the editor's. The licence line
 * is the same disclosure `SiteFooter` carries: Remotion is licensed separately from the MIT code.
 */
import { SITE_FOOTER_COLUMNS } from "@/components/site/SiteChrome";
import { REPO_URL } from "@/lib/site/primaryCta";
import { SLOGAN } from "./copy";
import { KiteMark } from "@/components/editor/KiteMark";

const REMOTION_LICENSE_URL = "https://www.remotion.dev/docs/license";

export function LandingFooter() {
  return (
    <footer className="l3d-footer" aria-label="Site">
      <div className="l3d-wrap l3d-footer-grid">
        <div className="l3d-footer-brand">
          <a className="l3d-logo" href="#l3d" aria-label="Hite, back to top">
            <KiteMark size={20} accent stroke={1.7} />
            Hite
          </a>
          <p className="l3d-footer-tagline">{SLOGAN}.</p>
          <p>
            MIT licensed. Remotion, the render engine, is licensed separately: free for individuals, non-profits and
            companies of up to three people.{" "}
            <a href={REMOTION_LICENSE_URL} rel="noreferrer">
              Read Remotion&apos;s terms.
            </a>
          </p>
        </div>
        {SITE_FOOTER_COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h3>{col.title}</h3>
            <ul>
              {col.links.map((l) => (
                <li key={l.href}>
                  <a href={l.href} {...(l.href.startsWith("http") ? { rel: "noreferrer" } : {})}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="l3d-wrap l3d-footer-line">
        <span>© {new Date().getFullYear()} Hite contributors</span>
        <a href={REPO_URL} rel="noreferrer">
          Source on GitHub
        </a>
      </div>
    </footer>
  );
}
