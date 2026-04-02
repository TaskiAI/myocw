/**
 * Offline bundle renderer.
 * Generates fully self-contained HTML pages for a course — math pre-rendered
 * server-side via katex.renderToString, no React, no CDN dependencies.
 */

import katex from "katex";
import { tokenizeInteractiveComponents, type ComponentSlot } from "@/app/components/interactive-problems/parse-tags";

// ---- Types ----

export interface BundleCourse {
  id: number;
  title: string;
  url: string;
  departments: { name: string }[];
  topics: { name: string }[];
}

export interface BundleSection {
  id: number;
  title: string;
  slug: string;
  section_type: string;
  ordering: number;
  parent_id: number | null;
}

export interface BundleResource {
  id: number;
  section_id: number | null;
  title: string;
  resource_type: string;
  youtube_id: string | null;
  content_text: string | null;
  ordering: number;
}

export interface BundleProblem {
  id: number;
  resource_id: number;
  problem_label: string;
  question_text: string;
  solution_text: string | null;
  ordering: number;
}

// ---- HTML Escaping ----

export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- Math + Markdown → HTML ----

let _componentCounter = 0;

function renderSlotHtml(slot: ComponentSlot): string {
  const uid = `c${_componentCounter++}`;

  if (slot.type === "FillInBlank") {
    const ans = esc(slot.answer);
    return `<span class="fill-blank" id="${uid}"><input type="text" class="blank-input" autocomplete="off" spellcheck="false" data-answer="${ans}"><button class="check-btn" onclick="checkBlank('${uid}')">Check</button><span class="feedback"></span></span>`;
  }

  if (slot.type === "MultipleChoice" && slot.options) {
    const ans = esc(slot.answer);
    const radios = slot.options
      .map((opt) => `<label class="mc-option"><input type="radio" name="${uid}" value="${esc(opt)}"> ${esc(opt)}</label>`)
      .join(" ");
    return `<span class="multi-choice" id="${uid}">${radios}<button class="check-btn" onclick="checkMC('${uid}','${ans}')">Check</button><span class="feedback"></span></span>`;
  }

  if (slot.type === "FreeResponse") {
    return `<div class="free-response"><textarea rows="3" placeholder="${esc(slot.prompt ?? "Your answer…")}"></textarea></div>`;
  }

  return "";
}

export function renderContent(source: string): string {
  if (!source?.trim()) return "";

  // Extract interactive component slots first, before math tokenization
  const { cleaned, slots } = tokenizeInteractiveComponents(source);

  // Replace component placeholders with interactive HTML
  // We do this via a unique marker approach: temporarily sub in the HTML
  const slotHtmlMap = new Map<string, string>();
  const SLOT_PFX = "\uE004SLOT";
  const SLOT_SFX = "\uE005";

  let withSlotMarkers = cleaned.replace(/\uE002COMP(\d+)\uE003/g, (_, i) => {
    const slot = slots[Number(i)];
    if (!slot) return "";
    const marker = `${SLOT_PFX}${i}${SLOT_SFX}`;
    slotHtmlMap.set(marker, renderSlotHtml(slot));
    return marker;
  });

  // Now run the normal markdown+math renderer on the text with slot markers
  // We need to prevent the slot markers from being HTML-escaped, so we
  // do a post-pass to swap them back in after renderContentRaw runs.
  source = withSlotMarkers;

  const segments: { type: "inline" | "display"; content: string }[] = [];
  const PFX = "\uE000MATH";
  const SFX = "\uE001";
  const ph = (i: number) => `${PFX}${i}${SFX}`;
  const PH_RE = new RegExp(`${PFX}(\\d+)${SFX}`, "g");
  const PH_TEST = new RegExp(`^${PFX}\\d+${SFX}$`);
  const PH_SPLIT = new RegExp(`(${PFX}\\d+${SFX})`);

  const withPh = source.replace(
    /\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]*?)\\\)/g,
    (_m, dd, bracket, inline, paren) => {
      const i = segments.length;
      if (dd !== undefined) segments.push({ type: "display", content: dd });
      else if (bracket !== undefined) segments.push({ type: "display", content: bracket });
      else if (paren !== undefined) segments.push({ type: "inline", content: paren });
      else segments.push({ type: "inline", content: inline ?? "" });
      return ph(i);
    }
  );

  function renderMath(text: string): string {
    return text.replace(PH_RE, (_, i) => {
      const seg = segments[Number(i)];
      if (!seg) return "";
      try {
        return katex.renderToString(seg.content.trim(), {
          displayMode: seg.type === "display",
          throwOnError: false,
          trust: true,
        });
      } catch {
        return esc(seg.type === "display" ? `$$${seg.content}$$` : `$${seg.content}$`);
      }
    });
  }

  function renderInline(text: string): string {
    return text
      .split(PH_SPLIT)
      .map((part) => {
        if (PH_TEST.test(part)) return renderMath(part);
        let p = esc(part);
        p = p.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
        p = p.replace(/__(.+?)__/g, "<strong>$1</strong>");
        p = p.replace(/\*(.+?)\*/g, "<em>$1</em>");
        p = p.replace(/(?<![A-Za-z0-9])_([^_\n]+?)_(?![A-Za-z0-9])/g, "<em>$1</em>");
        p = p.replace(/`([^`]+)`/g, "<code>$1</code>");
        p = p.replace(
          /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener">$1</a>'
        );
        return p;
      })
      .join("");
  }

  const lines = withPh.split(/\r?\n/);
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") { i++; continue; }

    // Standalone display math
    const mathMatch = trimmed.match(new RegExp(`^${PFX}(\\d+)${SFX}$`));
    if (mathMatch && segments[Number(mathMatch[1])]?.type === "display") {
      html.push(`<div class="math-block">${renderMath(trimmed)}</div>`);
      i++; continue;
    }

    // Code fence
    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      html.push(`<pre><code>${esc(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    // Headings
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const lvl = hm[1].length;
      html.push(`<h${lvl}>${renderInline(hm[2])}</h${lvl}>`);
      i++; continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      html.push("<ul>" + items.map((it) => `<li>${renderInline(it)}</li>`).join("") + "</ul>");
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      html.push("<ol>" + items.map((it) => `<li>${renderInline(it)}</li>`).join("") + "</ol>");
      continue;
    }

    // Paragraph
    const paraLines = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      const nt = next.trim();
      if (
        nt === "" ||
        /^#{1,6}\s+/.test(next) ||
        /^\s*[-*+]\s+/.test(next) ||
        /^\s*\d+\.\s+/.test(next) ||
        nt.startsWith("```") ||
        PH_TEST.test(nt)
      ) break;
      paraLines.push(next);
      i++;
    }
    html.push(`<p>${renderInline(paraLines.join(" "))}</p>`);
  }

  // Swap slot markers back in as raw HTML (esc() didn't touch the private-use chars)
  let result = html.join("\n");
  for (const [marker, slotHtml] of slotHtmlMap) {
    result = result.split(marker).join(slotHtml);
  }
  return result;
}

// ---- CSS ----

export const PAGE_CSS = `
.fill-blank{display:inline-flex;align-items:center;gap:4px;vertical-align:middle}
.blank-input{border:none;border-bottom:2px solid #aaa;background:transparent;font-size:inherit;font-family:inherit;width:100px;padding:1px 4px;outline:none;color:#1a1a1a}
.blank-input:focus{border-bottom-color:#750014}
.blank-input.correct{border-bottom-color:#1a7a4a;background:#f0faf4}
.blank-input.incorrect{border-bottom-color:#c0392b;background:#fff5f5}
.multi-choice{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px 12px;vertical-align:middle}
.mc-option{display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:.95em}
.mc-option input{cursor:pointer}
.check-btn{font-size:.78em;padding:2px 8px;border:1px solid #aaa;border-radius:3px;background:#f5f2ec;cursor:pointer;color:#444;line-height:1.6}
.check-btn:hover{background:#ece9e4}
.feedback{font-size:.85em;font-weight:bold;margin-left:2px}
.feedback.correct{color:#1a7a4a}
.feedback.incorrect{color:#c0392b}
.free-response textarea{width:100%;max-width:500px;padding:8px;border:1px solid #ccc;border-radius:4px;font-family:inherit;font-size:.95em;resize:vertical}
.child-section{margin-bottom:40px;padding-top:24px;border-top:2px solid #ece9e4}
.child-section-title{font-size:1.15em;font-weight:bold;color:#333;margin-bottom:16px}
.session-list{list-style:none;padding:0 0 0 16px;margin:4px 0 0}
.session-list li{border-bottom:1px solid #f0ede8}
.session-list li:last-child{border-bottom:none}
.session-list a{display:block;padding:7px 4px;font-size:.88em;text-decoration:none;color:#555}
.session-list a:hover{color:#750014}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.7;color:#1a1a1a;background:#fafaf8;max-width:800px;margin:0 auto;padding:24px 20px 60px}
a{color:#750014}a:visited{color:#5a0010}
h1{font-size:1.8em;margin:32px 0 12px;line-height:1.3}
h2{font-size:1.4em;margin:28px 0 10px}
h3{font-size:1.15em;margin:22px 0 8px}
h4,h5,h6{font-size:1em;margin:18px 0 6px}
p{margin:0 0 14px}
ul,ol{margin:0 0 14px 24px}li{margin-bottom:4px}
code{font-family:monospace;font-size:.9em;background:#f0ede8;padding:1px 5px;border-radius:3px}
pre{background:#1a1a1a;color:#e8e8e8;padding:16px;border-radius:6px;overflow-x:auto;margin:0 0 16px}
pre code{background:none;padding:0;color:inherit;font-size:.88em}
.math-block{margin:16px 0;text-align:center;overflow-x:auto}
.katex-display{overflow-x:auto}
.site-header{border-bottom:1px solid #ddd;padding-bottom:12px;margin-bottom:24px}
.site-header a{font-size:.9em;color:#666;text-decoration:none}
.site-header a:hover{color:#750014}
.section-title{font-size:1.5em;font-weight:bold;margin-bottom:4px}
.breadcrumb{font-size:.85em;color:#888;margin-bottom:20px;text-transform:capitalize}
.nav-strip{display:flex;justify-content:space-between;margin:32px 0 0;padding-top:16px;border-top:1px solid #ddd;font-size:.9em}
.nav-strip a{color:#750014;text-decoration:none}
.nav-strip a:hover{text-decoration:underline}
.resource{margin-bottom:36px}
.resource-title{font-size:1.1em;font-weight:bold;margin-bottom:10px;color:#333}
video{width:100%;border-radius:4px;background:#000}
.video-meta{font-size:.8em;color:#888;margin-top:8px}
.problem{border:1px solid #e0ddd8;border-radius:6px;margin-bottom:20px;overflow:hidden}
.problem-label{background:#f5f2ec;padding:8px 14px;font-size:.85em;font-weight:bold;color:#555;border-bottom:1px solid #e0ddd8}
.problem-body{padding:14px}
.problem-question{margin-bottom:14px}
.solution-toggle{font-size:.85em;color:#750014;cursor:pointer;border:none;background:none;padding:0;text-decoration:underline;margin-bottom:10px;display:block}
.solution{display:none;border-top:1px solid #e8e5e0;padding-top:12px;margin-top:8px}
.solution.open{display:block}
.solution-label{font-size:.8em;font-weight:bold;color:#888;margin-bottom:6px;letter-spacing:.05em;text-transform:uppercase}
.section-list{list-style:none;padding:0}
.section-list li{border-bottom:1px solid #ece9e4}
.section-list li:last-child{border-bottom:none}
.section-list a{display:block;padding:12px 4px;text-decoration:none;color:#1a1a1a;font-size:.95em}
.section-list a:hover{color:#750014}
.section-type{font-size:.78em;color:#999;margin-left:8px;text-transform:capitalize}
.course-meta{font-size:.88em;color:#666;margin-bottom:20px}
.course-meta span{margin-right:16px}
.footer{margin-top:48px;padding-top:16px;border-top:1px solid #ddd;font-size:.8em;color:#aaa}
`;

// ---- Page template ----

export function page(title: string, body: string, katexCssHref: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${katexCssHref}">
<style>${PAGE_CSS}</style>
</head>
<body>
${body}
<div class="footer">MIT OpenCourseWare content is licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>. Generated by myOCW.</div>
<script>
document.querySelectorAll('.solution-toggle').forEach(function(btn){
  btn.addEventListener('click',function(){
    var s=this.nextElementSibling;
    if(s){s.classList.toggle('open');this.textContent=s.classList.contains('open')?'Hide solution':'Show solution';}
  });
});
function checkBlank(id){
  var wrap=document.getElementById(id);
  if(!wrap)return;
  var input=wrap.querySelector('.blank-input');
  var fb=wrap.querySelector('.feedback');
  if(!input||!fb)return;
  var answer=input.dataset.answer||'';
  var correct=input.value.trim().toLowerCase()===answer.trim().toLowerCase();
  input.classList.toggle('correct',correct);
  input.classList.toggle('incorrect',!correct);
  fb.textContent=correct?'✓':'✗';
  fb.className='feedback '+(correct?'correct':'incorrect');
}
function checkMC(id,answer){
  var wrap=document.getElementById(id);
  if(!wrap)return;
  var sel=wrap.querySelector('input[type=radio]:checked');
  var fb=wrap.querySelector('.feedback');
  if(!fb)return;
  if(!sel){fb.textContent='Select an option';fb.className='feedback incorrect';return;}
  var correct=sel.value.trim().toLowerCase()===answer.trim().toLowerCase();
  fb.textContent=correct?'✓':'✗';
  fb.className='feedback '+(correct?'correct':'incorrect');
}
</script>
</body>
</html>`;
}

// ---- Renderers ----

function renderProblem(problem: BundleProblem): string {
  const solution = problem.solution_text
    ? `<button class="solution-toggle">Show solution</button>
<div class="solution">
  <div class="solution-label">Solution</div>
  ${renderContent(problem.solution_text)}
</div>`
    : "";

  return `<div class="problem">
<div class="problem-label">${esc(problem.problem_label)}</div>
<div class="problem-body">
  <div class="problem-question">${renderContent(problem.question_text)}</div>
  ${solution}
</div>
</div>`;
}

function renderResource(
  resource: BundleResource,
  problems: BundleProblem[]
): string {
  const parts: string[] = [`<div class="resource">`];

  if (resource.title) {
    parts.push(`<div class="resource-title">${esc(resource.title)}</div>`);
  }

  if (resource.youtube_id) {
    parts.push(`<video controls preload="metadata">
  <source src="../videos/${esc(resource.youtube_id)}.mp4" type="video/mp4">
  <p>Place <code>${esc(resource.youtube_id)}.mp4</code> in the videos/ folder to watch offline.</p>
</video>
<div class="video-meta">
  YouTube: <a href="https://youtube.com/watch?v=${esc(resource.youtube_id)}" target="_blank" rel="noopener">youtube.com/watch?v=${esc(resource.youtube_id)}</a>
  &mdash; save as <code>${esc(resource.youtube_id)}.mp4</code>
</div>`);
  }

  // Match live site (ScholarSessionPlayer): only problem_set resources with
  // interactive problems render from the problems table. Everything else uses
  // content_text. This filters out old model data (label "N", broken LaTeX).
  const isProblemSet = resource.resource_type === "problem_set";
  const hasInteractive = isProblemSet && problems.some((p) =>
    /<(FillInBlank|MultipleChoice|FreeResponse)\s/.test(p.question_text)
  );

  if (resource.content_text && !isProblemSet) {
    parts.push(`<div class="content">${renderContent(resource.content_text)}</div>`);
  }

  if (hasInteractive) {
    for (const p of problems) {
      parts.push(renderProblem(p));
    }
  }

  parts.push(`</div>`);
  return parts.join("\n");
}

export function renderSectionPage(
  course: BundleCourse,
  section: BundleSection,
  allSections: BundleSection[],
  resources: BundleResource[],
  problemsByResource: Map<number, BundleProblem[]>,
  prevSection: BundleSection | null,
  nextSection: BundleSection | null
): string {
  _componentCounter = 0;

  // Direct resources on this section
  const directResources = resources
    .filter((r) => r.section_id === section.id)
    .sort((a, b) => a.ordering - b.ordering);

  // Child sections (e.g. sessions under a unit)
  const children = allSections
    .filter((s) => s.parent_id === section.id)
    .sort((a, b) => a.ordering - b.ordering);

  let contentHtml = directResources
    .map((r) => renderResource(r, problemsByResource.get(r.id) ?? []))
    .join("\n");

  for (const child of children) {
    const childResources = resources
      .filter((r) => r.section_id === child.id)
      .sort((a, b) => a.ordering - b.ordering);
    if (childResources.length === 0) continue;
    contentHtml += `\n<div class="child-section" id="${esc(child.slug)}">
<div class="child-section-title">${esc(child.title)}</div>
${childResources.map((r) => renderResource(r, problemsByResource.get(r.id) ?? [])).join("\n")}
</div>`;
  }

  // Back link: if this is a child section, link up to the parent
  const parent = section.parent_id
    ? allSections.find((s) => s.id === section.parent_id)
    : null;
  const backLink = parent
    ? `<a href="${parent.slug}.html">&larr; ${esc(parent.title)}</a>`
    : `<a href="../index.html">&larr; ${esc(course.title)}</a>`;

  const nav = `<div class="nav-strip">
<div>${prevSection ? `&larr; <a href="${prevSection.slug}.html">${esc(prevSection.title)}</a>` : ""}</div>
<div>${nextSection ? `<a href="${nextSection.slug}.html">${esc(nextSection.title)}</a> &rarr;` : ""}</div>
</div>`;

  const body = `<div class="site-header">
${backLink}
</div>
<div class="section-title">${esc(section.title)}</div>
<div class="breadcrumb">${esc(humanizeSectionType(section.section_type))}</div>
${contentHtml || "<p>No content available for this section.</p>"}
${nav}`;

  return page(`${section.title} — ${course.title}`, body, "../katex/katex.min.css");
}

function humanizeSectionType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function renderIndexPage(
  course: BundleCourse,
  allSections: BundleSection[]
): string {
  const depts = course.departments?.map((d) => d.name).join(", ") ?? "";
  const topics = course.topics?.slice(0, 5).map((t) => t.name).join(", ") ?? "";

  const topLevel = allSections
    .filter((s) => s.parent_id === null)
    .sort((a, b) => a.ordering - b.ordering);

  const sectionItems = topLevel
    .map((s) => {
      const children = allSections
        .filter((c) => c.parent_id === s.id)
        .sort((a, b) => a.ordering - b.ordering);

      const childList = children.length > 0
        ? `<ul class="session-list">${children
            .map((c) => `<li><a href="sections/${c.slug}.html">${esc(c.title)}</a></li>`)
            .join("")}</ul>`
        : "";

      return `<li>
<a href="sections/${s.slug}.html">${esc(s.title)}<span class="section-type">${esc(humanizeSectionType(s.section_type))}</span></a>
${childList}
</li>`;
    })
    .join("\n");

  const body = `<h1>${esc(course.title)}</h1>
<div class="course-meta">
${depts ? `<span>&#127979; ${esc(depts)}</span>` : ""}
${topics ? `<span>&#127991; ${esc(topics)}</span>` : ""}
</div>
<h2>Contents</h2>
<ul class="section-list">
${sectionItems}
</ul>`;

  return page(course.title, body, "katex/katex.min.css");
}

export function renderReadme(
  course: BundleCourse,
  videoIds: string[]
): string {
  const lines = [
    course.title,
    "MIT OpenCourseWare — offline bundle generated by myOCW",
    "",
    "HOW TO USE",
    "----------",
    "Open index.html in any web browser. No internet connection required.",
    "",
  ];

  if (videoIds.length > 0) {
    lines.push("VIDEOS", "------");
    lines.push("Video files are not included (they are large).");
    lines.push("To watch videos offline, place compressed .mp4 files in the videos/ folder.");
    lines.push("");
    lines.push("Videos needed:");
    for (const id of videoIds) {
      lines.push(`  ${id}.mp4   (https://youtube.com/watch?v=${id})`);
    }
    lines.push("");
    lines.push("Compress with ffmpeg:");
    lines.push(
      `  ffmpeg -i input.mp4 -c:v libx264 -crf 35 -preset fast -vf "scale=640:-2,fps=15" -c:a aac -b:a 32k -ac 1 <youtube_id>.mp4`
    );
    lines.push("");
  }

  lines.push("LICENSE", "-------");
  lines.push("Content licensed under CC BY-NC-SA 4.0.");
  lines.push("https://creativecommons.org/licenses/by-nc-sa/4.0/");

  return lines.join("\n");
}
