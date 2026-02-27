"use client";

import { useEffect, useRef, useCallback } from "react";

// YouTube IFrame API types
declare global {
  interface Window {
    YT: {
      Player: new (
        elementId: string | HTMLElement,
        config: {
          videoId: string;
          width?: string | number;
          height?: string | number;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YTPlayer }) => void;
            onStateChange?: (event: { data: number; target: YTPlayer }) => void;
          };
        }
      ) => YTPlayer;
      PlayerState: {
        ENDED: 0;
        PLAYING: 1;
        PAUSED: 2;
        BUFFERING: 3;
        CUED: 5;
      };
    };
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

interface YTPlayer {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
}

interface Props {
  youtubeId: string;
  title: string;
  onVideoEnded?: () => void;
}

let apiLoaded = false;
let apiReady = false;
const readyCallbacks: (() => void)[] = [];

function loadYouTubeAPI(): Promise<void> {
  if (apiReady) return Promise.resolve();

  return new Promise((resolve) => {
    readyCallbacks.push(resolve);

    if (!apiLoaded) {
      apiLoaded = true;
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);

      window.onYouTubeIframeAPIReady = () => {
        apiReady = true;
        for (const cb of readyCallbacks) cb();
        readyCallbacks.length = 0;
      };
    }
  });
}

export default function YouTubePlayer({ youtubeId, title, onVideoEnded }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const onVideoEndedRef = useRef(onVideoEnded);
  const completionFiredRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep callback ref fresh without re-creating player
  useEffect(() => {
    onVideoEndedRef.current = onVideoEnded;
  }, [onVideoEnded]);

  const startPolling = useCallback((player: YTPlayer) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      try {
        const duration = player.getDuration();
        const current = player.getCurrentTime();
        if (duration > 0 && current / duration >= 0.8 && !completionFiredRef.current) {
          completionFiredRef.current = true;
          onVideoEndedRef.current?.();
        }
      } catch {
        // player might be destroyed
      }
    }, 5000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    completionFiredRef.current = false;
    let destroyed = false;

    loadYouTubeAPI().then(() => {
      if (destroyed || !containerRef.current) return;

      // Clear container for fresh player
      containerRef.current.innerHTML = "";
      const div = document.createElement("div");
      div.id = `yt-player-${youtubeId}`;
      containerRef.current.appendChild(div);

      playerRef.current = new window.YT.Player(div, {
        videoId: youtubeId,
        width: "100%",
        height: "100%",
        playerVars: {
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onStateChange: (event) => {
            // ENDED = 0
            if (event.data === 0 && !completionFiredRef.current) {
              completionFiredRef.current = true;
              onVideoEndedRef.current?.();
            }
            // PLAYING = 1 → start polling for 80% threshold
            if (event.data === 1) {
              startPolling(event.target);
            } else {
              stopPolling();
            }
          },
        },
      });
    });

    return () => {
      destroyed = true;
      stopPolling();
      try {
        playerRef.current?.destroy();
      } catch {
        // ignore
      }
      playerRef.current = null;
    };
  }, [youtubeId, startPolling, stopPolling]);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-black">
      <div className="relative aspect-video w-full">
        <div
          ref={containerRef}
          className="absolute inset-0 h-full w-full"
          title={title}
        />
      </div>
    </div>
  );
}
