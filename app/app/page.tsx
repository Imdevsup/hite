import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { KiteMark } from "@/components/editor/KiteMark";
import { NewProjectButton } from "./_components/NewProjectButton";
import { ProjectList } from "./_components/ProjectList";
import { DeepLinkPrompt } from "./_components/DeepLinkPrompt";

export const dynamic = "force-dynamic";

/**
 * THE WAY IN — the list of what you have already cut, and one button to start another.
 *
 * §13's kill list opens with WORKSHOP, and it was here: `HITE / WORKSHOP` in uppercase mono behind a
 * 700px radial glow, with `NEW PROJECT`, `DELETE`, `CONFIRM ✕`, `DELETING`, `JUST NOW` and
 * `OR PRESS NEW PROJECT, TOP RIGHT` under it. Every one of those is the visual grammar of a technical
 * manual, and this screen is the first thing anyone sees after the landing.
 *
 * The light rig went with it. §3.2: "There is no key light, no fill light, no radial gradient pair…
 * The room is one flat value." A blurred 700px accent circle behind a list of file names is the
 * template item that rule exists to delete.
 */
export default async function ProjectListPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("project")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false });

  const empty = !projects || projects.length === 0;

  return (
    <main className="flex h-full w-full flex-col overflow-y-auto">
      {/* The landing→editor deep link: `?prompt=` opens a fresh cut and forwards the sentence. */}
      <DeepLinkPrompt />

      <header className="flex shrink-0 items-center justify-between px-[var(--gutter)]" style={{ minHeight: "var(--nav-h)" }}>
        <Link href="/" aria-label="HITE — back to the home page" className="inline-flex h-[var(--tap)] items-center pr-[var(--space-3)]">
          <KiteMark size={22} stroke={1.6} accent />
        </Link>
        {!empty && <NewProjectButton />}
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-[var(--gutter)] pb-[var(--space-8)]">
        <div className="w-full max-w-[640px]">
          {empty ? (
            <div className="flex flex-col items-center gap-[var(--space-5)]">
              <p className="italic-serif text-center" style={{ fontSize: "44px", lineHeight: 1.05, color: "var(--t-2)" }}>
                Nothing cut yet
              </p>
              <NewProjectButton />
            </div>
          ) : (
            <ProjectList initialProjects={projects} />
          )}
        </div>
      </div>
    </main>
  );
}
