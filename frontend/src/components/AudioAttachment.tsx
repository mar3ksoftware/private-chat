import { useEffect, useMemo, useRef, useState } from 'react';
import { formatVoiceTime } from '../lib/time';
import type { MediaDescriptor } from '../types';

type AudioAttachmentProps = {
  readonly descriptor: MediaDescriptor;
  readonly blobUrl: string;
};

// Voice bubble: play/pause, slim progress bar, `current / total` time (C7).
// The bytes arrive through the same download + decrypt pipeline as images
// and video; if this browser cannot decode the format, the decrypted blob
// is offered as a plain download instead.
export function AudioAttachment({ descriptor, blobUrl }: AudioAttachmentProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(descriptor.d ?? 0);
  const [failed, setFailed] = useState(false);

  const canPlay = useMemo(() => {
    const probe = document.createElement('audio');
    return probe.canPlayType(descriptor.mime) !== '';
  }, [descriptor.mime]);

  useEffect(() => {
    if (!canPlay) setFailed(true);
  }, [canPlay]);

  const handleToggle = () => {
    const element = audioRef.current;
    if (element === null) return;
    if (element.paused) {
      element.play().catch(() => setFailed(true));
    } else {
      element.pause();
    }
  };

  if (failed) {
    return (
      <a
        href={blobUrl}
        download={descriptor.name ?? 'voice'}
        className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm transition-colors hover:bg-white/10"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        Download
      </a>
    );
  }

  const percent = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  return (
    <div className="flex min-w-52 items-center gap-3">
      {/* biome-ignore lint/a11y/useMediaCaption: voice notes have no caption track */}
      <audio
        ref={audioRef}
        src={blobUrl}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration;
          if (Number.isFinite(duration) && duration > 0) setTotal(duration);
        }}
        onError={() => setFailed(true)}
        className="hidden"
      />
      <button
        type="button"
        onClick={handleToggle}
        aria-label={playing ? 'Pause' : 'Play'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25"
      >
        {playing ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14z" />
          </svg>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="h-1 w-full overflow-hidden rounded-full bg-black/30">
          <div className="h-full rounded-full bg-white/70" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-1 text-[11px] tabular-nums opacity-90">
          {formatVoiceTime(current)} / {formatVoiceTime(total)}
        </p>
      </div>
    </div>
  );
}
