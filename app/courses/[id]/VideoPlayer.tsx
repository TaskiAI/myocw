import type { Resource } from "@/lib/types/course-content";

export default function VideoPlayer({ resource }: { resource: Resource }) {
  if (resource.youtube_id) {
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="relative aspect-video w-full">
          <iframe
            src={`https://www.youtube.com/embed/${resource.youtube_id}`}
            title={resource.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        </div>
        <div className="px-4 py-3">
          <p className="text-sm font-medium text-zinc-900">{resource.title}</p>
        </div>
      </div>
    );
  }

  if (resource.archive_url) {
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="relative aspect-video w-full bg-black">
          <video
            src={resource.archive_url}
            controls
            className="absolute inset-0 h-full w-full"
          >
            <track kind="captions" />
          </video>
        </div>
        <div className="px-4 py-3">
          <p className="text-sm font-medium text-zinc-900">{resource.title}</p>
        </div>
      </div>
    );
  }

  return null;
}
