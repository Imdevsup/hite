import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { parseJsonBody } from "@/lib/api/body";
import { dbErrorResponse } from "@/lib/api/errors";
import { z } from "zod";

const WindowState = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  size: z.object({ width: z.number(), height: z.number() }),
  zIndex: z.number(),
  minimized: z.boolean().default(false),
  focused: z.boolean().default(false),
  docked: z.enum(["left", "right", "top", "bottom"]).nullable().default(null),
});

const Layout = z.object({
  version: z.literal(1).default(1),
  windows: z.array(WindowState),
});

type Ctx = { params: Promise<{ id: string }> };

export function GET(_req: Request, { params }: Ctx) {
  return withAuth(async ({ supabase }) => {
    const { id } = await params;
    const { data, error } = await supabase
      .from("project")
      .select("window_layout")
      .eq("id", id)
      .single();
    if (error) return dbErrorResponse(error);
    return NextResponse.json(data.window_layout);
  });
}

export function PUT(req: Request, { params }: Ctx) {
  return withAuth(async ({ supabase }) => {
    const { id } = await params;
    // 400 with the offending window field, not a Next 500 — see lib/api/body.ts.
    const body = await parseJsonBody(req, Layout);
    const { error } = await supabase
      .from("project")
      .update({ window_layout: body })
      .eq("id", id);
    if (error) return dbErrorResponse(error);
    return NextResponse.json({ ok: true });
  });
}
