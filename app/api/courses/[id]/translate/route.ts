/**
 * POST /api/courses/[id]/translate
 *
 * Translates course content into the requested language.
 * Streams JSON-line progress updates back to the client.
 *
 * Body: { "language": "Spanish" }
 * Response: streaming JSON lines
 *   { "status": "translating", "done": 5, "total": 42 }
 *   ...
 *   { "status": "complete", "done": 42, "total": 42 }
 */

export const runtime = "nodejs";

import { createClient as createServerClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { translateCourseContent } from "@/lib/translate";
import { LANGUAGE_NAMES } from "@/lib/languages";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const courseId = Number(id);

  if (Number.isNaN(courseId)) {
    return NextResponse.json({ error: "Invalid course id" }, { status: 400 });
  }

  // Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  let language: string;
  try {
    const body = await req.json();
    language = body.language;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!language || (!LANGUAGE_NAMES.includes(language) && language !== "Other")) {
    return NextResponse.json(
      { error: "Invalid language", supported: LANGUAGE_NAMES },
      { status: 400 }
    );
  }

  if (language === "English") {
    return NextResponse.json({ status: "complete", done: 0, total: 0 });
  }

  // Verify course exists
  const admin = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
  const { data: course } = await admin
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .single();

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  // Stream progress
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await translateCourseContent(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SECRET_KEY!,
          process.env.OPENAI_API_KEY!,
          courseId,
          language,
          (p) => {
            const line = JSON.stringify({
              status: p.done === p.total ? "complete" : "translating",
              done: p.done,
              total: p.total,
            });
            controller.enqueue(encoder.encode(line + "\n"));
          }
        );
        controller.close();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Translation failed";
        controller.enqueue(
          encoder.encode(JSON.stringify({ status: "error", error: msg }) + "\n")
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
    },
  });
}
