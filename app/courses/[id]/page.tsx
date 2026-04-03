import { notFound } from "next/navigation";
import {
  getCourseById,
  getCourseSections,
  getCourseResources,
  getCourseProblems,
} from "@/lib/queries/course-content";
import { getDevEditorAccess } from "@/lib/queries/user-pset-drafts-server";
import { getUserLanguageServer } from "@/lib/queries/user-profile-server";
import { applyTranslations } from "@/lib/queries/translations";
import CoursePageContent from "./CoursePageContent";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function CourseDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const courseId = parseInt(id, 10);
  if (isNaN(courseId)) notFound();

  const course = await getCourseById(courseId);
  if (!course) notFound();

  const [sections, rawResources, rawProblems, resolvedSearchParams, devEditorAccess, userLanguage] = await Promise.all([
    getCourseSections(courseId),
    getCourseResources(courseId),
    getCourseProblems(courseId),
    searchParams,
    getDevEditorAccess(),
    getUserLanguageServer(),
  ]);

  // Apply cached translations if user has a non-English language set
  const { problems, resources } = await applyTranslations(courseId, userLanguage, rawProblems, rawResources);

  const hasContent = course.content_downloaded && sections.length > 0;

  const lectureParam = resolvedSearchParams.lecture;
  // URL is 1-indexed (lecture=1 is first), convert to 0-indexed for internal use
  const initialLecture =
    typeof lectureParam === "string" ? parseInt(lectureParam, 10) - 1 : undefined;

  return (
    <CoursePageContent
      course={course}
      sections={sections}
      resources={resources}
      problems={problems}
      canEditContent={devEditorAccess.canEdit}
      hasContent={hasContent}
      initialLecture={isNaN(initialLecture as number) ? undefined : initialLecture}
    />
  );
}
