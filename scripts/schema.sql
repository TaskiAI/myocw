-- Run this in the Supabase SQL Editor to create the courses table.

-- 1. Courses table
create table if not exists public.courses (
  id             bigint primary key,           -- MIT Learn API id
  readable_id    text unique not null,          -- e.g. "6.001+spring_2005"
  title          text not null,
  description    text,
  url            text,
  image_url      text,
  image_alt      text,

  -- Nested / array data stored as JSONB
  topics         jsonb default '[]'::jsonb,     -- [{id, name, parent}]
  departments    jsonb default '[]'::jsonb,     -- [{department_id, name, school}]
  runs           jsonb default '[]'::jsonb,     -- [{semester, year, level, instructors, image}]
  course_feature jsonb default '[]'::jsonb,     -- ["Lecture Videos", "Problem Sets", ...]

  -- Generated boolean columns for fast filtering
  has_lecture_videos boolean generated always as (course_feature @> '["Lecture Videos"]'::jsonb) stored,
  has_problem_sets   boolean generated always as (course_feature @> '["Problem Sets"]'::jsonb) stored,

  -- Free / certification
  free           boolean default true,
  certification  boolean default false,
  views          integer default 0,

  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- 2. Indexes
create index if not exists idx_courses_readable_id on public.courses (readable_id);
create index if not exists idx_courses_topics      on public.courses using gin (topics);
create index if not exists idx_courses_features    on public.courses using gin (course_feature);
create index if not exists idx_courses_departments on public.courses using gin (departments);
create index if not exists idx_courses_has_videos  on public.courses (has_lecture_videos) where has_lecture_videos = true;
create index if not exists idx_courses_has_psets   on public.courses (has_problem_sets)   where has_problem_sets = true;

-- 3. Auto-update updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists courses_updated_at on public.courses;
create trigger courses_updated_at
  before update on public.courses
  for each row execute function public.handle_updated_at();

-- 4. RLS — publicly readable, only service role can write
alter table public.courses enable row level security;

drop policy if exists "Courses are publicly readable" on public.courses;
create policy "Courses are publicly readable"
  on public.courses for select
  using (true);
