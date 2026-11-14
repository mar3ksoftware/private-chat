import { useEffect, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { downloadAndDecrypt, getCached, putCached } from '../lib/media';
import type { MediaDescriptor } from '../types';
import { AudioAttachment } from './AudioAttachment';

type MediaAttachmentProps = {
  readonly descriptor: MediaDescriptor;
};

type MediaStatus = 'loading' | 'ready' | 'expired' | 'error';

export function MediaAttachment({ descriptor }: MediaAttachmentProps) {
  const { mediaToken } = useChat();
  const [status, setStatus] = useState<MediaStatus>('loading');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const cached = getCached(descriptor.fileId);
    if (cached !== undefined) {
      if (cached.status === 'ready') {
        setBlobUrl(cached.blobUrl);
        setStatus('ready');
      } else {
        setStatus(cached.status);
      }
      return;
    }

    setStatus('loading');
    setBlobUrl(null);
    downloadAndDecrypt(descriptor, mediaToken).then((result) => {
      if (cancelled) return;
      if (result.status === 'ready') {
        const url = URL.createObjectURL(new Blob([result.bytes], { type: descriptor.mime }));
        putCached(descriptor.fileId, { status: 'ready', blobUrl: url });
        setBlobUrl(url);
        setStatus('ready');
      } else {
        setStatus(result.status);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [descriptor, mediaToken]);

  if (status === 'ready' && blobUrl !== null) {
    // Voice bubbles dispatch before the image/video branches (C7).
    if (descriptor.mime.startsWith('audio/')) {
      return <AudioAttachment descriptor={descriptor} blobUrl={blobUrl} />;
    }
    if (descriptor.mime.startsWith('image/')) {
      return <img src={blobUrl} className="max-h-80 rounded-lg" alt={descriptor.name ?? 'Image'} />;
    }
    // biome-ignore lint/a11y/useMediaCaption: user-uploaded clips have no caption track
    return <video src={blobUrl} controls preload="metadata" className="max-h-80 rounded-lg" />;
  }
  if (status === 'expired') {
    return <p className="text-sm text-zinc-400">Attachment expired</p>;
  }
  if (status === 'error') {
    return <p className="text-sm text-rose-400">Attachment unavailable</p>;
  }
  return <p className="text-sm text-zinc-400">Loading…</p>;
}
