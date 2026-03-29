import { createClient } from "@/lib/supabase/client";

export async function getUserLanguage(): Promise<string | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("user_profiles")
    .select("language")
    .eq("user_id", user.id)
    .single();

  return data?.language ?? null;
}

export async function setUserLanguage(language: string): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("user_profiles")
    .upsert(
      { user_id: user.id, language, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
}
