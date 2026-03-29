import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const envFile = readFileSync('.env.local', 'utf8');
function getEnv(name: string) {
  const m = envFile.match(new RegExp(`${name}\\s*=\\s*"(.+?)"`));
  return m?.[1] ?? '';
}
const sb = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'));

const ALL_SLUGS = [
  '3-091sc-introduction-to-solid-state-chemistry-fall-2010',
  '6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016',
  '6-0002-introduction-to-computational-thinking-and-data-science-fall-2016',
  'res-6-007-signals-and-systems-spring-2011',
  '6-002-circuits-and-electronics-spring-2007',
  '8-03sc-physics-iii-vibrations-and-waves-fall-2016',
  '6-041sc-probabilistic-systems-analysis-and-applied-probability-fall-2013',
  '2-003sc-engineering-dynamics-fall-2011',
  '6-006-introduction-to-algorithms-spring-2020',
  '6-042j-mathematics-for-computer-science-spring-2015',
  '8-04-quantum-physics-i-spring-2016',
  '18-s096-topics-in-mathematics-with-applications-in-finance-fall-2013',
  '18-01sc-single-variable-calculus-fall-2010',
  '18-02sc-multivariable-calculus-fall-2010',
  '18-03sc-differential-equations-fall-2011',
  '18-06sc-linear-algebra-fall-2011',
  '5-111sc-principles-of-chemical-science-fall-2014',
  '7-01sc-fundamentals-of-biology-fall-2011',
  '6-01sc-introduction-to-electrical-engineering-and-computer-science-i-spring-2011',
  '14-01sc-principles-of-microeconomics-fall-2011',
  '15-401-finance-theory-i-fall-2008',
  '8-01sc-classical-mechanics-fall-2016',
];

async function main() {
  console.log('Course | PsetRes | SolRes | ExamRes | Problems | NeedsParsing');
  console.log('--- | --- | --- | --- | --- | ---');
  for (const slug of ALL_SLUGS) {
    const { data: course } = await sb.from('courses').select('id, problems_parsed').ilike('url', '%' + slug + '%').single();
    if (!course) { console.log(`${slug} | NOT FOUND`); continue; }
    const { count: psets } = await sb.from('resources').select('*', { count: 'exact', head: true }).eq('course_id', course.id).eq('resource_type', 'problem_set');
    const { count: solutions } = await sb.from('resources').select('*', { count: 'exact', head: true }).eq('course_id', course.id).eq('resource_type', 'solution');
    const { count: exams } = await sb.from('resources').select('*', { count: 'exact', head: true }).eq('course_id', course.id).eq('resource_type', 'exam');
    const { count: problems } = await sb.from('problems').select('*', { count: 'exact', head: true }).eq('course_id', course.id);
    const parsable = (psets ?? 0) + (exams ?? 0);
    const needsParsing = parsable > 0 && (problems ?? 0) === 0;
    const shortSlug = slug.split('-').slice(0, 3).join('-');
    console.log(`${shortSlug} | ${psets} | ${solutions} | ${exams} | ${problems} | ${needsParsing ? 'YES' : ''}`);
  }
}
main();
