import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const MIT_API_BASE = "https://api.learn.mit.edu/api/v1/courses/";
const PAGE_SIZE = 100;
const UPSERT_BATCH_SIZE = 200;
const DELAY_MS = 5000; // 5 seconds between API requests to avoid rate-limiting

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

interface MITApiResponse {
  count: number;
  next: string | null;
  results: MITCourse[];
}

interface MITCourse {
  id: number;
  readable_id: string;
  title: string;
  description: string | null;
  url: string | null;
  image?: { url: string; alt?: string } | null;
  topics: { id: number; name: string; parent: number | null }[];
  departments: {
    department_id: string;
    name: string;
    school?: { id: number; name: string; url: string } | null;
  }[];
  runs: {
    id: number;
    semester: string | null;
    year: number | null;
    level?: { code: string; name: string }[];
    instructors: { id: number; first_name: string; last_name: string; full_name: string }[];
    image?: { url: string; alt?: string } | null;
  }[];
  course_feature: string[];
  free: boolean;
  certification: boolean;
  views: number;
}

function transformCourse(course: MITCourse) {
  return {
    id: course.id,
    readable_id: course.readable_id,
    title: course.title,
    description: course.description,
    url: course.url,
    image_url: course.image?.url ?? null,
    image_alt: course.image?.alt ?? null,
    topics: course.topics.map((t) => ({ id: t.id, name: t.name, parent: t.parent })),
    departments: course.departments.map((d) => ({
      department_id: d.department_id,
      name: d.name,
      school: d.school ?? null,
    })),
    runs: course.runs.map((r) => ({
      id: r.id,
      semester: r.semester,
      year: r.year,
      level: r.level ?? [],
      instructors: r.instructors,
      image: r.image ?? null,
    })),
    course_feature: course.course_feature,
    free: course.free,
    certification: course.certification,
    views: course.views,
  };
}

async function fetchAllCourses(): Promise<MITCourse[]> {
  const allCourses: MITCourse[] = [];
  let page = 1;
  let url: string | null = `${MIT_API_BASE}?platform=ocw&limit=${PAGE_SIZE}`;

  while (url) {
    let data: MITApiResponse | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Fetching page ${page}${attempt > 1 ? ` (attempt ${attempt})` : ""}...`);
        const res: Response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) {
          throw new Error(`MIT API returned ${res.status}: ${res.statusText}`);
        }
        data = await res.json();
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        console.log(`  Request failed, retrying in 10s...`);
        await sleep(10_000);
      }
    }
    allCourses.push(...data!.results);
    console.log(`  Got ${data!.results.length} courses (total: ${allCourses.length}/${data!.count})`);
    url = data!.next?.replace("http://", "https://") ?? null;
    if (url) await sleep(DELAY_MS);
    page++;
  }

  return allCourses;
}

async function upsertCourses(courses: MITCourse[]) {
  const rows = courses.map(transformCourse);

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase.from("courses").upsert(batch, { onConflict: "id" });
    if (error) {
      throw new Error(`Upsert failed at batch ${i}: ${error.message}`);
    }
    console.log(`Upserted batch ${i / UPSERT_BATCH_SIZE + 1} (${batch.length} rows)`);
  }
}

async function main() {
  console.log("Starting MIT OCW course ingestion...\n");

  const courses = await fetchAllCourses();
  console.log(`\nFetched ${courses.length} courses total. Upserting to Supabase...\n`);

  await upsertCourses(courses);

  console.log(`\nDone! ${courses.length} courses upserted.`);
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
