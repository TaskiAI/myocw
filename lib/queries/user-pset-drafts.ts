import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  normalizeUserPsetDraft,
  prepareUserPsetDraftInput,
  type UserPsetDraft,
  type UserPsetDraftInput,
} from "@/lib/types/manual-pset";
import { DEV_EDITOR_EMAIL } from "@/lib/queries/user-pset-drafts-shared";

interface RawDraftRow {
  id: number | string;
  user_id: string;
  title: string | null;
  source_pdf_label: string | null;
  source_pdf_url: string | null;
  notes: string | null;
  problems: unknown;
  created_at: string;
  updated_at: string;
}

function toDraft(row: RawDraftRow | null | undefined): UserPsetDraft | null {
  if (!row) return null;
  return normalizeUserPsetDraft(row);
}

async function requireDevEditor() {
  const supabase = createBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email !== DEV_EDITOR_EMAIL) {
    return { supabase, user: null };
  }

  return { supabase, user };
}

export async function createUserPsetDraft(
  input: UserPsetDraftInput
): Promise<UserPsetDraft | null> {
  const { supabase, user } = await requireDevEditor();
  if (!user) return null;

  const payload = prepareUserPsetDraftInput(input);
  const { data, error } = await supabase
    .from("user_pset_drafts")
    .insert({
      user_id: user.id,
      title: payload.title,
      source_pdf_label: payload.source_pdf_label,
      source_pdf_url: payload.source_pdf_url,
      notes: payload.notes,
      problems: payload.problems,
    })
    .select("*")
    .single();

  if (error || !data) {
    console.error("Error creating pset draft:", error);
    return null;
  }

  return toDraft(data as RawDraftRow);
}

export async function updateUserPsetDraft(
  draftId: number,
  input: UserPsetDraftInput
): Promise<UserPsetDraft | null> {
  const { supabase, user } = await requireDevEditor();
  if (!user) return null;

  const payload = prepareUserPsetDraftInput(input);
  const { data, error } = await supabase
    .from("user_pset_drafts")
    .update({
      title: payload.title,
      source_pdf_label: payload.source_pdf_label,
      source_pdf_url: payload.source_pdf_url,
      notes: payload.notes,
      problems: payload.problems,
    })
    .eq("id", draftId)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error || !data) {
    console.error("Error updating pset draft:", error);
    return null;
  }

  return toDraft(data as RawDraftRow);
}

export async function deleteUserPsetDraft(draftId: number): Promise<boolean> {
  const { supabase, user } = await requireDevEditor();
  if (!user) return false;

  const { error } = await supabase
    .from("user_pset_drafts")
    .delete()
    .eq("id", draftId)
    .eq("user_id", user.id);

  if (error) {
    console.error("Error deleting pset draft:", error);
  }

  return !error;
}
