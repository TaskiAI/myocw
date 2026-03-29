"use server";

import { createClient as createAuthClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { DEV_EDITOR_EMAIL } from "@/lib/queries/user-pset-drafts-shared";

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}

async function requireDevEditor() {
  const supabase = await createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.email !== DEV_EDITOR_EMAIL) return null;
  return user;
}

export async function updateSectionTitle(
  sectionId: number,
  title: string
): Promise<{ id: number; title: string } | null> {
  const user = await requireDevEditor();
  if (!user) return null;

  const trimmed = title.trim();
  if (!trimmed) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("course_sections")
    .update({ title: trimmed })
    .eq("id", sectionId)
    .select("id, title")
    .single();

  if (error || !data) return null;
  return data as { id: number; title: string };
}

export async function updateResourceTitle(
  resourceId: number,
  title: string
): Promise<{ id: number; title: string } | null> {
  const user = await requireDevEditor();
  if (!user) return null;

  const trimmed = title.trim();
  if (!trimmed) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("resources")
    .update({ title: trimmed })
    .eq("id", resourceId)
    .select("id, title")
    .single();

  if (error || !data) return null;
  return data as { id: number; title: string };
}

export async function updateResourceContentText(
  resourceId: number,
  contentText: string
): Promise<boolean> {
  const user = await requireDevEditor();
  if (!user) return false;

  const admin = createAdminClient();
  const { error } = await admin
    .from("resources")
    .update({ content_text: contentText })
    .eq("id", resourceId);

  return !error;
}
