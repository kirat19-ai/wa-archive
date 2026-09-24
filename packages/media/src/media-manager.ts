import type { IWhatsAppAdapter, NormalizedMediaRef } from '@wa-archive/shared';
import type { Repositories } from '@wa-archive/database';
import type { ArchiveStorage } from './storage.js';
import { extForMedia, sha256 } from './hash.js';

export interface MediaJob {
  accountId: string;
  mediaId: string;
  ref: NormalizedMediaRef;
  adapter: IWhatsAppAdapter;
}

export type MediaEmit = (event: string, payload: unknown) => void;

/** Optional thumbnail generator — kept pluggable so the core needs no native deps. */
export type Thumbnailer = (data: Buffer, mediaType: string) => Promise<Buffer | null>;

export interface MediaManagerOptions {
  concurrency?: number;
  /** Retry backoff schedule in ms (spec §24). Overridable for tests. */
  backoffMs?: number[];
  emit?: MediaEmit;
  thumbnailer?: Thumbnailer;
}

const DEFAULT_BACKOFF = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];

/**
 * Downloads media off the connection event loop (spec §23): a bounded-concurrency
 * queue that downloads, validates, hashes, de-duplicates (spec §22), stores, and
 * marks archived — with exponential backoff and a FAILED terminal state (spec §24).
 *
 * Never marks a row ARCHIVED unless the bytes were actually stored (spec §24).
 */
export class MediaManager {
  private queue: MediaJob[] = [];
  private active = 0;
  private readonly concurrency: number;
  private readonly backoff: number[];
  private readonly emit: MediaEmit;
  private readonly thumbnailer?: Thumbnailer;

  constructor(
    private readonly repos: Repositories,
    private readonly storage: ArchiveStorage,
    opts: MediaManagerOptions = {},
  ) {
    this.concurrency = opts.concurrency ?? 3;
    this.backoff = opts.backoffMs ?? DEFAULT_BACKOFF;
    this.emit = opts.emit ?? (() => {});
    this.thumbnailer = opts.thumbnailer;
  }

  enqueue(job: MediaJob): void {
    this.queue.push(job);
    this.emit('archive.media.queued', { accountId: job.accountId, mediaId: job.mediaId });
    this.pump();
  }

  /** Number of jobs still queued or in flight (used by tests to await drain). */
  get pending(): number {
    return this.queue.length + this.active;
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active++;
      void this.process(job).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async process(job: MediaJob): Promise<void> {
    const { accountId, mediaId, ref, adapter } = job;
    this.repos.media.markDownloading(mediaId);
    try {
      const { data, mimeType } = await adapter.downloadMedia(ref);
      if (!data || data.length === 0) throw new Error('empty media payload');

      const hash = sha256(data);

      // Dedup: reuse an existing physical file for identical bytes (spec §22).
      const dup = this.repos.media.findArchivedBySha(accountId, hash);
      let storagePath: string;
      let thumbnailPath: string | null;
      if (dup && dup.storagePath && this.storage.exists(dup.storagePath)) {
        storagePath = dup.storagePath;
        thumbnailPath = dup.thumbnailPath ?? null;
      } else {
        const ext = extForMedia(mimeType ?? ref.mimeType, ref.originalFilename);
        storagePath = await this.storage.save(accountId, ref.mediaType, mediaId, ext, data);
        thumbnailPath = await this.makeThumbnail(accountId, mediaId, ref.mediaType, data);
      }

      this.repos.media.markArchived(mediaId, {
        storagePath,
        sha256: hash,
        fileSize: data.length,
        thumbnailPath,
      });
      this.emit('archive.media.downloaded', { accountId, mediaId, dedup: Boolean(dup) });
    } catch (err) {
      this.handleFailure(job, err);
    }
  }

  private handleFailure(job: MediaJob, err: unknown): void {
    const { accountId, mediaId } = job;
    this.repos.media.incrementAttempts(mediaId);
    const row = this.repos.media.get(accountId, mediaId);
    const attempts = row?.downloadAttempts ?? 1;

    if (attempts <= this.backoff.length) {
      const delay = this.backoff[attempts - 1] ?? this.backoff[this.backoff.length - 1]!;
      setTimeout(() => this.enqueue(job), delay).unref?.();
    } else {
      // Terminal failure — never falsely claim it was archived (spec §24).
      this.repos.media.markFailed(mediaId);
      this.emit('archive.media.failed', {
        accountId,
        mediaId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async makeThumbnail(
    accountId: string,
    mediaId: string,
    mediaType: string,
    data: Buffer,
  ): Promise<string | null> {
    if (!this.thumbnailer) return null;
    try {
      const thumb = await this.thumbnailer(data, mediaType);
      if (!thumb) return null;
      return await this.storage.saveThumbnail(accountId, mediaId, thumb);
    } catch {
      return null; // thumbnails are best-effort; never fail archival over one
    }
  }
}
