import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { parseJsonBody } from "@/lib/api/body";
import { dbErrorResponse } from "@/lib/api/errors";
import { z } from "zod";

const Create = z.object({
  title: z.string().min(1).max(120).default("Untitled Cut"),
});

export function GET() {
  return withAuth(async ({ supabase }) => {
    const { data, error } = await supabase
      .from("project")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    if (error) return dbErrorResponse(error);
    return NextResponse.json({ projects: data ?? [] });
  });
}

export function POST(req: Request) {
  return withAuth(async ({ user, supabase }) => {
    // parseJsonBody, not Create.parse: a bad body is a CLIENT contract violation and must be a 400
    // naming the field. A raw ZodError/SyntaxError escapes withAuth as a Next 500.
    const body = await parseJsonBody(req, Create);
    const { data, error } = await supabase
      .from("project")
      .insert({ title: body.title, owner_user_id: user.id })
      .select("id, title")
      .single();
    if (error) return dbErrorResponse(error);
    return NextResponse.json(data);
  });
}
