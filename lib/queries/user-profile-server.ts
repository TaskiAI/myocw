import { createClient } from "@/lib/supabase/server";

export async function getUserLanguageServer(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("user_profiles")
    .select("language")
    .eq("user_id", user.id)
    .single();

  return data?.language ?? null;
}
