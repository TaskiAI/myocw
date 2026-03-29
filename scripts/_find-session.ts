import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);

async function main() {
  const { data: sections } = await supabase
    .from("course_sections")
    .select("id, title, section_type, ordering, parent_id")
    .eq("course_id", 4974)
    .order("ordering")
    .limit(10);

  console.log("Sections:");
  for (const s of sections!) console.log(`  ${s.id} | ${s.section_type.padEnd(12)} | ord=${s.ordering} | parent=${s.parent_id ?? "-"} | ${s.title}`);

  const firstSession = sections!.find(s => s.section_type !== "unit" && s.parent_id);
  if (!firstSession) { console.log("No session found"); return; }
  console.log(`\nFirst session: ${firstSession.title} (id=${firstSession.id})`);

  const { data: resources } = await supabase
    .from("resources")
    .select("id, title, resource_type, pdf_path")
    .eq("section_id", firstSession.id)
    .not("pdf_path", "is", null)
    .in("resource_type", ["solution", "lecture_notes"])
    .order("ordering");

  console.log(`\nResources to convert:`);
  for (const r of resources!) console.log(`  ${r.id} | ${r.resource_type.padEnd(14)} | ${r.title}`);
  console.log(`\nResource IDs: ${resources!.map(r => r.id).join(", ")}`);
}
main();
