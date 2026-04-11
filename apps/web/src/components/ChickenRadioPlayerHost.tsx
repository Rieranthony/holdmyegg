import { useEffect, useRef } from "react";
import type {
  ChickenRadioPlaybackPreference,
  ChickenRadioPlaybackState,
  ChickenRadioStation,
} from "../app/chickenRadio";

interface YouTubePlayer {
  cueVideoById: (videoId: string) => void;
  destroy: () => void;
  loadVideoById: (videoId: string) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  setVolume: (volume: number) => void;
}

interface YouTubePlayerEvent {
  data: number;
  target: YouTubePlayer;
}

interface YouTubePlayerConfig {
  events?: {
    onAutoplayBlocked?: (event: YouTubePlayerEvent) => void;
    onReady?: (event: YouTubePlayerEvent) => void;
    onStateChange?: (event: YouTubePlayerEvent) => void;
  };
  height?: string;
  playerVars?: Record<string, number | string>;
  videoId?: string;
  width?: string;
}

interface YouTubeNamespace {
  Player: new (
    container: HTMLElement,
    config: YouTubePlayerConfig,
  ) => YouTubePlayer;
  PlayerState: {
    BUFFERING: number;
    CUED: number;
    ENDED: number;
    PAUSED: number;
    PLAYING: number;
    UNSTARTED: number;
  };
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: (() => void) | undefined;
  }
}

let youtubeIframeApiPromise: Promise<YouTubeNamespace> | null = null;

const loadYouTubeIframeApi = (): Promise<YouTubeNamespace> => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Chicken Radio requires a browser."));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeIframeApiPromise) {
    return youtubeIframeApiPromise;
  }

  youtubeIframeApiPromise = new Promise<YouTubeNamespace>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-youtube-iframe-api="true"]',
    );
    const previousReady = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();

      if (window.YT?.Player) {
        resolve(window.YT);
      }
    };

    if (existingScript) {
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.dataset.youtubeIframeApi = "true";
    script.src = "https://www.youtube.com/iframe_api";
    script.addEventListener("error", () => {
      youtubeIframeApiPromise = null;
      reject(new Error("Chicken Radio could not load the YouTube player."));
    });
    document.head.append(script);
  });

  return youtubeIframeApiPromise;
};

interface ChickenRadioPlayerHostProps {
  onPlaybackStateChange: (state: ChickenRadioPlaybackState) => void;
  playAttemptToken: number;
  playbackPreference: ChickenRadioPlaybackPreference;
  station: ChickenRadioStation;
  volume: number;
}

export function ChickenRadioPlayerHost({
  onPlaybackStateChange,
  playAttemptToken,
  playbackPreference,
  station,
  volume,
}: ChickenRadioPlayerHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const readyRef = useRef(false);
  const blockedRef = useRef(false);
  const lastStationIdRef = useRef<string | null>(null);
  const lastVolumeRef = useRef<number | null>(null);
  const lastPlaybackPreferenceRef =
    useRef<ChickenRadioPlaybackPreference | null>(null);
  const lastPlayAttemptTokenRef = useRef(playAttemptToken);
  const latestStateRef = useRef({
    onPlaybackStateChange,
    playbackPreference,
    station,
    volume,
  });

  latestStateRef.current = {
    onPlaybackStateChange,
    playbackPreference,
    station,
    volume,
  };

  const syncPlayer = (forcePlay = false) => {
    const player = playerRef.current;
    if (!player || !readyRef.current) {
      return;
    }

    const {
      onPlaybackStateChange: reportPlaybackState,
      playbackPreference: nextPlaybackPreference,
      station: nextStation,
      volume: nextVolume,
    } = latestStateRef.current;
    const shouldPlay = nextPlaybackPreference === "play";
    const stationChanged = lastStationIdRef.current !== nextStation.id;
    const volumeChanged = lastVolumeRef.current !== nextVolume;
    const playbackPreferenceChanged =
      lastPlaybackPreferenceRef.current !== nextPlaybackPreference;

    if (volumeChanged) {
      player.setVolume(nextVolume);
      lastVolumeRef.current = nextVolume;
    }

    if (stationChanged) {
      blockedRef.current = false;
      lastStationIdRef.current = nextStation.id;
      lastPlaybackPreferenceRef.current = nextPlaybackPreference;

      if (shouldPlay) {
        reportPlaybackState("loading");
        player.loadVideoById(nextStation.videoId);
        return;
      }

      reportPlaybackState("paused");
      player.cueVideoById(nextStation.videoId);
      return;
    }

    if (forcePlay && shouldPlay) {
      blockedRef.current = false;
      lastPlaybackPreferenceRef.current = nextPlaybackPreference;
      reportPlaybackState("loading");
      player.playVideo();
      return;
    }

    if (playbackPreferenceChanged) {
      blockedRef.current = false;
      lastPlaybackPreferenceRef.current = nextPlaybackPreference;

      if (shouldPlay) {
        reportPlaybackState("loading");
        player.playVideo();
      } else {
        reportPlaybackState("paused");
        player.pauseVideo();
      }
    }
  };

  useEffect(() => {
    let disposed = false;

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (disposed || !containerRef.current || playerRef.current) {
          return;
        }

        playerRef.current = new YT.Player(containerRef.current, {
          height: "200",
          width: "200",
          videoId: latestStateRef.current.station.videoId,
          playerVars: {
            controls: 0,
            disablekb: 1,
            enablejsapi: 1,
            fs: 0,
            modestbranding: 1,
            origin: window.location.origin,
            playsinline: 1,
          },
          events: {
            onAutoplayBlocked: () => {
              blockedRef.current = true;
              latestStateRef.current.onPlaybackStateChange("blocked");
            },
            onReady: () => {
              readyRef.current = true;
              syncPlayer();
            },
            onStateChange: (event) => {
              if (event.data === YT.PlayerState.PLAYING) {
                blockedRef.current = false;
                latestStateRef.current.onPlaybackStateChange("playing");
                return;
              }

              if (event.data === YT.PlayerState.BUFFERING) {
                latestStateRef.current.onPlaybackStateChange("loading");
                return;
              }

              if (
                blockedRef.current &&
                (event.data === YT.PlayerState.CUED ||
                  event.data === YT.PlayerState.PAUSED ||
                  event.data === YT.PlayerState.UNSTARTED)
              ) {
                return;
              }

              if (
                event.data === YT.PlayerState.CUED ||
                event.data === YT.PlayerState.PAUSED ||
                event.data === YT.PlayerState.ENDED ||
                event.data === YT.PlayerState.UNSTARTED
              ) {
                latestStateRef.current.onPlaybackStateChange("paused");
              }
            },
          },
        });
      })
      .catch(() => {
        if (!disposed) {
          latestStateRef.current.onPlaybackStateChange("paused");
        }
      });

    return () => {
      disposed = true;
      readyRef.current = false;
      blockedRef.current = false;
      lastStationIdRef.current = null;
      lastVolumeRef.current = null;
      lastPlaybackPreferenceRef.current = null;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    syncPlayer();
  }, [playbackPreference, station.id, volume]);

  useEffect(() => {
    if (playAttemptToken === lastPlayAttemptTokenRef.current) {
      return;
    }

    lastPlayAttemptTokenRef.current = playAttemptToken;
    syncPlayer(true);
  }, [playAttemptToken]);

  return (
    <div
      aria-hidden="true"
      className="chicken-radio-player-host"
      data-testid="chicken-radio-player-host"
    >
      <div
        className="chicken-radio-player-host__mount"
        ref={containerRef}
      />
    </div>
  );
}
