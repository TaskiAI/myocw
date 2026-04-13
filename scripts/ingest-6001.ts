import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import * as cheerio from "cheerio";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

const COURSE_ID = 5107;
const COURSE_SLUG =
  "6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016";
const STORAGE_BASE = `https://krwivhwlbjsmzislfiiv.supabase.co/storage/v1/object/public/mit-ocw/courses/${COURSE_SLUG}`;
const ZIP_DIR = "/tmp/myocw-6001";

// --- Session definitions ---

interface SessionDef {
  number: number;
  title: string;
  youtubeId: string;
  slidesPdf: string;
  codePy: string; // resource slug in ZIP
  inClassLecture: number | null; // lecture number for in-class questions (null = none)
  pset: PsetDef | null;
}

interface PsetDef {
  title: string;
  pdfPath: string;
}

const SESSIONS: SessionDef[] = [
  {
    number: 1,
    title: "What is Computation?",
    youtubeId: "nykOeWgQcHM",
    slidesPdf: "lecture-1-welcome.pdf",
    codePy: "lec1",
    inClassLecture: 1,
    pset: null,
  },
  {
    number: 2,
    title: "Branching and Iteration",
    youtubeId: "0jljZRnHwOI",
    slidesPdf: "lecture-2-branching-iteration.pdf",
    codePy: "lec2_branch_loops",
    inClassLecture: 2,
    pset: null,
  },
  {
    number: 3,
    title: "String Manipulation, Guess and Check, Approximations, Bisection",
    youtubeId: "SE4P7IVCunE",
    slidesPdf:
      "lecture-3-string-manipulation-guess-and-check-approximations-bisection.pdf",
    codePy: "lec3_strings_algos",
    inClassLecture: 3,
    pset: {
      title: "Problem Set 0",
      pdfPath: "mit6-0001f16-problemset0.pdf",
    },
  },
  {
    number: 4,
    title: "Decomposition, Abstractions, Functions",
    youtubeId: "MjbuarJ7SE0",
    slidesPdf: "lecture-4-decomposition-abstraction-functions.pdf",
    codePy: "lec4_functions",
    inClassLecture: 4,
    pset: null,
  },
  {
    number: 5,
    title: "Tuples, Lists, Aliasing, Mutability, Cloning",
    youtubeId: "RvRKT-jXvko",
    slidesPdf: "lecture-5-tuples-lists-aliasing-mutability-cloning.pdf",
    codePy: "lec5_tuples_lists",
    inClassLecture: 5,
    pset: {
      title: "Problem Set 1",
      pdfPath: "problem-set-1.pdf",
    },
  },
  {
    number: 6,
    title: "Recursion, Dictionaries",
    youtubeId: "WPSeyjX1-4s",
    slidesPdf: "lecture-6-recursion-dictionaries.pdf",
    codePy: "lec6_recursion_dictionaries",
    inClassLecture: null,
    pset: null,
  },
  {
    number: 7,
    title: "Testing, Debugging, Exceptions, Assertions",
    youtubeId: "9H6muyZjms0",
    slidesPdf: "lecture-7-testing-debugging-exceptions-assertions.pdf",
    codePy: "lec7_debug_except",
    inClassLecture: 7,
    pset: {
      title: "Problem Set 2",
      pdfPath: "mit6-0001f16-pset2.pdf",
    },
  },
  {
    number: 8,
    title: "Object Oriented Programming",
    youtubeId: "-DP1i2ZU9gk",
    slidesPdf: "lecture-8-object-oriented-programming.pdf",
    codePy: "lec8_classes",
    inClassLecture: 8,
    pset: null,
  },
  {
    number: 9,
    title: "Python Classes and Inheritance",
    youtubeId: "FlGjISF3l78",
    slidesPdf: "lecture-9-python-classes-and-inheritance.pdf",
    codePy: "lec9_inheritance",
    inClassLecture: 9,
    pset: {
      title: "Problem Set 3",
      pdfPath: "mit6-0001f16-problemset3.pdf",
    },
  },
  {
    number: 10,
    title: "Understanding Program Efficiency, Part 1",
    youtubeId: "o9nW0uBqvEo",
    slidesPdf: "lecture-10-understanding-program-efficiency-1.pdf",
    codePy: "lec10_complexity_part1",
    inClassLecture: null,
    pset: {
      title: "Problem Set 4",
      pdfPath: "mit6-0001f16-pset4.pdf",
    },
  },
  {
    number: 11,
    title: "Understanding Program Efficiency, Part 2",
    youtubeId: "7lQXYl_L28w",
    slidesPdf: "lecture-11-understanding-program-efficiency-2.pdf",
    codePy: "lec11_complexity_part2",
    inClassLecture: null,
    pset: null,
  },
  {
    number: 12,
    title: "Searching and Sorting",
    youtubeId: "6LOwPhPDwVc",
    slidesPdf: "lecture-12-searching-and-sorting-algorithms.pdf",
    codePy: "lec12_sorting",
    inClassLecture: null,
    pset: {
      title: "Problem Set 5",
      pdfPath: "mit6-0001f16-ps5-2.pdf",
    },
  },
];

// --- In-class question parser ---

interface InClassQuestion {
  title: string;
  questionText: string; // markdown with code block
  options: string[];
  correctIndex: number;
  videoUrl: string | null;
}

function parseInClassQuestions(lecNum: number): InClassQuestion[] {
  const htmlPath = `${ZIP_DIR}/pages/in-class-questions-and-video-solutions/lecture-${lecNum}/index.html`;
  let html: string;
  try {
    html = readFileSync(htmlPath, "utf-8");
  } catch {
    console.log(`  No in-class questions file for lecture ${lecNum}`);
    return [];
  }

  const $ = cheerio.load(html);
  const questions: InClassQuestion[] = [];

  // Questions are in <li> elements containing <h4> + content + <div class="multiple-choice-question">
  // Some <li> elements have multiple MC divs (multi-part questions)
  $("li").each((_, li) => {
    const $li = $(li);
    const $h4 = $li.find("h4").first();
    const $mcDivs = $li.find(".multiple-choice-question");
    if (!$h4.length || !$mcDivs.length) return;

    const title = $h4.text().trim();

    // Get question text: <p> and <pre> siblings between h4 and first multiple-choice div
    const questionParts: string[] = [];
    let $el = $h4.next();
    while ($el.length && !$el.hasClass("multiple-choice-question")) {
      if ($el.is("p")) {
        questionParts.push($el.text().trim());
      } else if ($el.is("pre") || ($el.is("div") && $el.hasClass("highlight"))) {
        const code = $el.find("pre").length ? $el.find("pre").text().trim() : $el.text().trim();
        questionParts.push("\n```python\n" + code + "\n```\n");
      }
      $el = $el.next();
    }
    const baseQuestionText = questionParts.join("\n").trim();

    // Process each MC div as a separate question
    $mcDivs.each((mcIdx, mcDiv) => {
      const $mcDiv = $(mcDiv);

      // For subsequent MC divs, look for additional question text between MC divs
      let questionText = baseQuestionText;
      if (mcIdx > 0) {
        // Look for <p> text between previous MC div and this one
        const extraParts: string[] = [];
        let $prev = $mcDiv.prev();
        while ($prev.length && !$prev.hasClass("multiple-choice-question")) {
          if ($prev.is("p")) {
            extraParts.unshift($prev.text().trim());
          } else if ($prev.is("pre") || ($prev.is("div") && $prev.hasClass("highlight"))) {
            const code = $prev.find("pre").length ? $prev.find("pre").text().trim() : $prev.text().trim();
            extraParts.unshift("\n```python\n" + code + "\n```\n");
          }
          $prev = $prev.prev();
        }
        if (extraParts.length) {
          questionText = extraParts.join("\n").trim();
        }
      }

      // Parse choices
      const options: string[] = [];
      let correctIndex = 0;
      $mcDiv.find(".multiple-choice-div").each((i, div) => {
        const $label = $(div).find("label").first();
        if (!$label.length) return;

        const isCorrect = $label.find(".correctness-icon-correct").length > 0;

        // Get direct text nodes from label (exclude icon span text)
        let choiceText = "";
        $label.contents().each((_, node) => {
          if (node.type === "text") {
            choiceText += $(node).text();
          }
        });
        choiceText = choiceText.trim();

        if (choiceText) {
          if (isCorrect) correctIndex = options.length;
          options.push(choiceText);
        }
      });

      // Find video solution URL nearest to this MC div
      // Look for archive.org links after this MC div
      let videoUrl: string | null = null;
      const $nextSiblings = $mcDiv.nextAll('a[href*="archive.org/download"]');
      // Also check within the surrounding container
      $li.find('a[href*="archive.org/download"]').each((_, a) => {
        const href = $(a).attr("href");
        if (href && href.includes("exercise") && !videoUrl) {
          // Match by exercise number
          const exerciseMatch = href.match(/exercise_(\d+)/);
          if (exerciseMatch) {
            const exNum = parseInt(exerciseMatch[1]);
            if (exNum === questions.length + 1) {
              videoUrl = href;
            }
          }
        }
      });

      // Fallback: construct URL from pattern
      if (!videoUrl) {
        const exerciseNum = String(questions.length + 1).padStart(2, "0");
        const lecStr = String(lecNum).padStart(2, "0");
        videoUrl = `https://archive.org/download/MIT6.0001F16/MIT6_0001F16_Lecture_${lecStr}_exercise_${exerciseNum}_300k.mp4`;
      }

      const partLabel = $mcDivs.length > 1 ? `${title} (Part ${mcIdx + 1})` : title;

      if (options.length > 0) {
        questions.push({
          title: partLabel,
          questionText,
          options,
          correctIndex,
          videoUrl,
        });
      }
    });
  });

  return questions;
}

// --- Main ingestion ---

async function main() {
  console.log("=== Ingesting 6.0001 (course ID: 5107) ===\n");

  // Step 1: Wipe existing data
  console.log("Step 1: Wiping existing data...");

  const { error: probErr } = await supabase
    .from("problems")
    .delete()
    .eq("course_id", COURSE_ID);
  if (probErr) throw new Error(`Failed to delete problems: ${probErr.message}`);
  console.log("  Deleted existing problems");

  const { data: existingSections } = await supabase
    .from("course_sections")
    .select("id")
    .eq("course_id", COURSE_ID);
  if (existingSections?.length) {
    const sectionIds = existingSections.map((s) => s.id);
    const { error: resErr } = await supabase
      .from("resources")
      .delete()
      .in("section_id", sectionIds);
    if (resErr)
      throw new Error(`Failed to delete resources: ${resErr.message}`);
    console.log(`  Deleted existing resources (${sectionIds.length} sections)`);
  }

  const { error: secErr } = await supabase
    .from("course_sections")
    .delete()
    .eq("course_id", COURSE_ID);
  if (secErr)
    throw new Error(`Failed to delete sections: ${secErr.message}`);
  console.log("  Deleted existing sections");

  // Also clean up sidebar order
  const { error: sidebarErr } = await supabase
    .from("course_sidebar_order")
    .delete()
    .eq("course_id", COURSE_ID);
  if (sidebarErr) console.log("  (no sidebar order to clean)");

  // Mark course as scholar so it uses ScholarSessionPlayer
  const { error: scholarErr } = await supabase
    .from("courses")
    .update({ is_scholar: true })
    .eq("id", COURSE_ID);
  if (scholarErr) throw new Error(`Failed to set is_scholar: ${scholarErr.message}`);
  console.log("  Set is_scholar = true");

  // Step 2 & 3: Create unit + sessions with resources
  console.log("\nStep 2-3: Creating unit and sessions with resources...\n");

  // Create a single unit to contain all sessions
  const { data: unitSection, error: unitErr } = await supabase
    .from("course_sections")
    .insert({
      course_id: COURSE_ID,
      title: "Course Content",
      slug: "course-content",
      section_type: "unit",
      ordering: 0,
    })
    .select("id")
    .single();
  if (unitErr) throw new Error(`Failed to create unit: ${unitErr.message}`);
  console.log(`Created unit section (id=${unitSection.id})\n`);

  let totalProblems = 0;

  for (const session of SESSIONS) {
    console.log(
      `Session ${session.number}: ${session.title}`
    );

    // Create session section as child of unit
    const { data: section, error: secInsErr } = await supabase
      .from("course_sections")
      .insert({
        course_id: COURSE_ID,
        title: `Session ${session.number}: ${session.title}`,
        slug: `session-${session.number}`,
        section_type: "lecture",
        ordering: session.number - 1,
        parent_id: unitSection.id,
      })
      .select("id")
      .single();
    if (secInsErr)
      throw new Error(`Failed to create section: ${secInsErr.message}`);

    const sectionId = section.id;
    let ordering = 0;

    // Resource 1: Lecture video
    const { error: vidErr } = await supabase.from("resources").insert({
      course_id: COURSE_ID,
      section_id: sectionId,
      title: `Lecture ${session.number}: ${session.title}`,
      resource_type: "video",
      youtube_id: session.youtubeId,
      ordering: ordering++,
    });
    if (vidErr)
      throw new Error(`Failed to create video resource: ${vidErr.message}`);
    console.log(`  + Video (${session.youtubeId})`);

    // Resource 2: Lecture slides (PDF)
    const { error: slidesErr } = await supabase.from("resources").insert({
      course_id: COURSE_ID,
      section_id: sectionId,
      title: "Lecture Slides",
      resource_type: "lecture_notes",
      pdf_path: `${STORAGE_BASE}/${session.slidesPdf}`,
      ordering: ordering++,
    });
    if (slidesErr)
      throw new Error(`Failed to create slides resource: ${slidesErr.message}`);
    console.log(`  + Slides (${session.slidesPdf})`);

    // Resource 3: Lecture code (.py) — read from ZIP and store as content_text
    const codePath = `${ZIP_DIR}/resources/${session.codePy}/data.json`;
    try {
      const codeData = JSON.parse(readFileSync(codePath, "utf-8"));
      const codeFilePath = codeData.file;
      if (codeFilePath) {
        // Read the actual .py file from static_resources
        const filename = codeFilePath.split("/").pop()!;
        const pyPath = `${ZIP_DIR}/static_resources/${filename}`;
        try {
          const pyContent = readFileSync(pyPath, "utf-8");
          const { error: codeErr } = await supabase.from("resources").insert({
            course_id: COURSE_ID,
            section_id: sectionId,
            title: "Lecture Code",
            resource_type: "lecture_notes",
            content_text: "```python\n" + pyContent + "\n```",
            ordering: ordering++,
          });
          if (codeErr)
            throw new Error(
              `Failed to create code resource: ${codeErr.message}`
            );
          console.log(`  + Code (${filename})`);
        } catch (e: any) {
          console.log(`  - Code file not found: ${pyPath}`);
        }
      }
    } catch {
      console.log(`  - No code data for ${session.codePy}`);
    }

    // Resource 4: In-class questions
    if (session.inClassLecture !== null) {
      const questions = parseInClassQuestions(session.inClassLecture);
      if (questions.length > 0) {
        // Create a problem_set resource for the in-class questions
        const { data: icResource, error: icErr } = await supabase
          .from("resources")
          .insert({
            course_id: COURSE_ID,
            section_id: sectionId,
            title: "In-Class Questions",
            resource_type: "problem_set",
            ordering: ordering++,
          })
          .select("id")
          .single();
        if (icErr)
          throw new Error(
            `Failed to create in-class resource: ${icErr.message}`
          );

        // Create problems for each question
        for (let qi = 0; qi < questions.length; qi++) {
          const q = questions[qi];

          // Build question_text with MultipleChoice tag
          const optionsJson = JSON.stringify(q.options);
          const answer = q.options[q.correctIndex];
          const questionText =
            `${q.questionText}\n\n` +
            `<MultipleChoice options={${optionsJson}} answer="${answer.replace(/"/g, "&quot;")}" />`;

          // Build explanation with video link
          const explanationText = q.videoUrl
            ? `[Watch video solution](${q.videoUrl})`
            : null;

          const { error: probInsErr } = await supabase
            .from("problems")
            .insert({
              resource_id: icResource.id,
              course_id: COURSE_ID,
              problem_label: q.title,
              question_text: questionText,
              solution_text: q.options[q.correctIndex],
              explanation_text: explanationText,
              ordering: qi,
            });
          if (probInsErr)
            throw new Error(
              `Failed to create problem: ${probInsErr.message}`
            );
          totalProblems++;
        }
        console.log(`  + In-Class Questions (${questions.length} problems)`);
      }
    }

    // Resource 5: Problem set (if applicable)
    if (session.pset) {
      const { error: psetErr } = await supabase.from("resources").insert({
        course_id: COURSE_ID,
        section_id: sectionId,
        title: session.pset.title,
        resource_type: "problem_set",
        pdf_path: `${STORAGE_BASE}/${session.pset.pdfPath}`,
        ordering: ordering++,
      });
      if (psetErr)
        throw new Error(
          `Failed to create pset resource: ${psetErr.message}`
        );
      console.log(`  + ${session.pset.title} (${session.pset.pdfPath})`);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Created 12 sessions with resources`);
  console.log(`Created ${totalProblems} in-class question problems`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
