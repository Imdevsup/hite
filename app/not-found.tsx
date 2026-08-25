import Link from "next/link";
import { KiteMark } from "@/components/editor/KiteMark";

export default function NotFound() {
  return (
    <main className="h-screen w-screen flex flex-col items-center justify-center bg-[var(--color-bg)] px-6">
      <KiteMark size={56} muted stroke={1.3} />
      <p className="empty-state mt-8">Nothing here to cut.</p>
      <Link href="/app" className="btn btn-primary mt-8">
        BACK TO WORKSHOP
      </Link>
    </main>
  );
}
