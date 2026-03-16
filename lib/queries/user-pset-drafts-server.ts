import "server-only";

import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  normalizeUserPsetDraft,
  type UserPsetDraft,
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

export async function getDevEditorAccess(): Promise<{
  userId: string | null;
  email: string | null;
  canEdit: boolean;
}> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { userId: null, email: null, canEdit: false };
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    canEdit: user.email === DEV_EDITOR_EMAIL,
  };
}

export async function getUserPsetDrafts(): Promise<{
  userId: string | null;
  email: string | null;
  canEdit: boolean;
  drafts: UserPsetDraft[];
}> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { userId: null, email: null, canEdit: false, drafts: [] };
  }

  const canEdit = user.email === DEV_EDITOR_EMAIL;
  if (!canEdit) {
    return {
      userId: user.id,
      email: user.email ?? null,
      canEdit,
      drafts: [],
    };
  }

  const { data, error } = await supabase
    .from("user_pset_drafts")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Error fetching pset drafts:", error);
    return {
      userId: user.id,
      email: user.email ?? null,
      canEdit,
      drafts: [],
    };
  }

  const drafts = (data ?? [])
    .map((row) => toDraft(row as RawDraftRow))
    .filter((draft): draft is UserPsetDraft => draft !== null);

  return {
    userId: user.id,
    email: user.email ?? null,
    canEdit,
    drafts,
  };
}
