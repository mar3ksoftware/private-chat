import { describe, expect, test } from 'bun:test';
import { MediaStore } from './media-store';

function bytes(size: number): Uint8Array {
  return new Uint8Array(size).fill(7);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('MediaStore', () => {
  test('put/get round-trips identical bytes and tracks totals', () => {
    const store = new MediaStore({ sweepIntervalMs: 0 });
    try {
      const payload = new Uint8Array([1, 2, 3, 4]);
      expect(store.put('id-a', payload)).toBe('ok');
      expect(store.put('id-b', bytes(6))).toBe('ok');

      expect(store.fileCount).toBe(2);
      expect(store.totalBytes).toBe(10);
      expect(store.get('id-a')).toEqual(payload);
      expect(store.get('id-a')?.length).toBe(4);
    } finally {
      store.destroy();
    }
  });

  test('put above maxFileBytes is too_large and leaves the store unchanged', () => {
    const store = new MediaStore({ maxFileBytes: 8, sweepIntervalMs: 0 });
    try {
      expect(store.put('id-a', bytes(4))).toBe('ok');
      expect(store.put('id-b', bytes(9))).toBe('too_large');

      expect(store.fileCount).toBe(1);
      expect(store.totalBytes).toBe(4);
      expect(store.get('id-b')).toBeUndefined();
    } finally {
      store.destroy();
    }
  });

  test('byte quota rejects new entries and keeps prior entries intact', () => {
    const store = new MediaStore({ maxTotalBytes: 10, sweepIntervalMs: 0 });
    try {
      expect(store.put('id-a', bytes(6))).toBe('ok');
      expect(store.put('id-b', bytes(5))).toBe('quota_exceeded');

      expect(store.fileCount).toBe(1);
      expect(store.totalBytes).toBe(6);
      expect(store.get('id-a')?.length).toBe(6);
      expect(store.get('id-b')).toBeUndefined();
    } finally {
      store.destroy();
    }
  });

  test('file-count quota rejects the third distinct id', () => {
    const store = new MediaStore({ maxFiles: 2, sweepIntervalMs: 0 });
    try {
      expect(store.put('id-a', bytes(1))).toBe('ok');
      expect(store.put('id-b', bytes(1))).toBe('ok');
      expect(store.put('id-c', bytes(1))).toBe('quota_exceeded');

      expect(store.fileCount).toBe(2);
      expect(store.totalBytes).toBe(2);
      expect(store.get('id-c')).toBeUndefined();
    } finally {
      store.destroy();
    }
  });

  test('replacing an id accounts the delta and rejects over-quota replacements', () => {
    const store = new MediaStore({ maxTotalBytes: 100, sweepIntervalMs: 0 });
    try {
      expect(store.put('id-a', bytes(60))).toBe('ok');
      expect(store.put('id-b', bytes(40))).toBe('ok');
      expect(store.totalBytes).toBe(100);

      expect(store.put('id-a', bytes(50))).toBe('ok');
      expect(store.fileCount).toBe(2);
      expect(store.totalBytes).toBe(90);

      expect(store.put('id-b', bytes(70))).toBe('quota_exceeded');
      expect(store.fileCount).toBe(2);
      expect(store.totalBytes).toBe(90);
      expect(store.get('id-b')?.length).toBe(40);
    } finally {
      store.destroy();
    }
  });

  test('expired entries disappear from get and drop fileCount', () => {
    let now = 0;
    const store = new MediaStore({ ttlMs: 1_000, sweepIntervalMs: 0, now: () => now });
    try {
      expect(store.put('id-a', bytes(4))).toBe('ok');
      expect(store.fileCount).toBe(1);

      now = 999;
      expect(store.get('id-a')).toBeDefined();
      expect(store.fileCount).toBe(1);

      now = 1_000;
      expect(store.get('id-a')).toBeUndefined();
      expect(store.fileCount).toBe(0);
      expect(store.totalBytes).toBe(0);
    } finally {
      store.destroy();
    }
  });

  test('sweep removes only expired entries and returns the count', () => {
    let now = 0;
    const store = new MediaStore({ ttlMs: 1_000, sweepIntervalMs: 0, now: () => now });
    try {
      expect(store.put('id-old', bytes(3))).toBe('ok');
      now = 500;
      expect(store.put('id-new', bytes(5))).toBe('ok');

      now = 1_200;
      expect(store.sweep()).toBe(1);
      expect(store.fileCount).toBe(1);
      expect(store.totalBytes).toBe(5);
      expect(store.get('id-old')).toBeUndefined();
      expect(store.get('id-new')?.length).toBe(5);
      expect(store.sweep()).toBe(0);
    } finally {
      store.destroy();
    }
  });

  test('destroy stops the sweep interval', async () => {
    let sweptNow = 0;
    const swept = new MediaStore({ ttlMs: 1_000, sweepIntervalMs: 10, now: () => sweptNow });
    let keptNow = 0;
    const kept = new MediaStore({ ttlMs: 1_000, sweepIntervalMs: 10, now: () => keptNow });
    try {
      expect(swept.put('id-a', bytes(4))).toBe('ok');
      expect(kept.put('id-a', bytes(4))).toBe('ok');

      sweptNow = 2_000;
      await delay(60);
      expect(swept.fileCount).toBe(0);

      kept.destroy();
      keptNow = 2_000;
      await delay(60);
      expect(kept.fileCount).toBe(1);
    } finally {
      swept.destroy();
      kept.destroy();
    }
  });
});
