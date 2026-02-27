import { notFound } from "next/navigation";
import {
  getCourseById,
  getCourseSections,
  getCourseResources,
} from "@/lib/queries/course-content";
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

  const [sections, resources, resolvedSearchParams] = await Promise.all([
    getCourseSections(courseId),
    getCourseResources(courseId),
    searchParams,
  ]);

  // Extract slug from course URL for PDF paths
  const courseSlug = course.url
    ? new URL(course.url).pathname.split("/").filter(Boolean).pop() ?? ""
    : "";

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
      courseSlug={courseSlug}
      hasContent={hasContent}
      initialLecture={isNaN(initialLecture as number) ? undefined : initialLecture}
    />
  );
}
