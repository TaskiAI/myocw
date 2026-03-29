import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

async function main() {
  // Only scholar courses
  const { data: scholarCourses, error: cErr } = await supabase
    .from("courses")
    .select("id")
    .eq("is_scholar", true);

  if (cErr || !scholarCourses) {
    console.error("Failed to fetch scholar courses:", cErr);
    process.exit(1);
  }

  const scholarIds = scholarCourses.map((c) => c.id);
  console.log(`Found ${scholarIds.length} scholar courses`);

  // Get all problem_set resources in scholar courses, ordered by section + ordering
  const { data: resources, error: rErr } = await supabase
    .from("resources")
    .select("id, title, resource_type, section_id, ordering, course_id")
    .eq("resource_type", "problem_set")
    .in("course_id", scholarIds)
    .order("section_id")
    .order("ordering");

  if (rErr || !resources) {
    console.error("Failed to fetch resources:", rErr);
    process.exit(1);
  }

  console.log(`Found ${resources.length} problem_set resources in scholar courses`);

  // Group by section to find solution/problem pairs
  const bySection = new Map<number, typeof resources>();
  for (const r of resources) {
    if (r.section_id == null) continue;
    if (!bySection.has(r.section_id)) bySection.set(r.section_id, []);
    bySection.get(r.section_id)!.push(r);
  }

  const renameToProblemSet: number[] = [];
  const convertToSolution: { id: number; title: string }[] = [];

  for (const [sectionId, sectionResources] of bySection) {
    // Sort by ordering within the section
    sectionResources.sort((a, b) => a.ordering - b.ordering);

    for (let i = 0; i < sectionResources.length; i++) {
      const r = sectionResources[i];
      const titleLower = r.title.toLowerCase();
      const isSolution = titleLower.includes("sol");

      if (isSolution) {
        // Find the problem set this is a solution for (previous problem_set resource)
        let psetTitle = "Problem Set";
        for (let j = i - 1; j >= 0; j--) {
          const prev = sectionResources[j];
          if (!prev.title.toLowerCase().includes("sol")) {
            // This is the problem set it belongs to
            psetTitle = prev.title === "Problem Set" || renameToProblemSet.includes(prev.id)
              ? "Problem Set"
              : prev.title;
            break;
          }
        }
        convertToSolution.push({ id: r.id, title: `${psetTitle} Solutions` });
        console.log(`  [${r.id}] "${r.title}" → "${psetTitle} Solutions" (type → solution)`);
      } else {
        if (r.title !== "Problem Set") {
          renameToProblemSet.push(r.id);
          console.log(`  [${r.id}] "${r.title}" → "Problem Set"`);
        }
      }
    }
  }

  console.log(`\nRenaming ${renameToProblemSet.length} to "Problem Set"`);
  console.log(`Converting ${convertToSolution.length} to solutions`);

  // Batch rename problem sets
  if (renameToProblemSet.length > 0) {
    const { error, count } = await supabase
      .from("resources")
      .update({ title: "Problem Set" }, { count: "exact" })
      .in("id", renameToProblemSet);

    if (error) {
      console.error("Failed to rename problem sets:", error);
    } else {
      console.log(`Renamed ${count} resources to "Problem Set"`);
    }
  }

  // Convert solutions one by one (each has a unique title)
  let solCount = 0;
  for (const sol of convertToSolution) {
    const { error } = await supabase
      .from("resources")
      .update({ title: sol.title, resource_type: "solution" })
      .eq("id", sol.id);

    if (error) {
      console.error(`Failed to update solution ${sol.id}:`, error);
    } else {
      solCount++;
    }
  }
  console.log(`Converted ${solCount} resources to solutions`);
}

main();
