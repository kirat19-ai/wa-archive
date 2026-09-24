import { and, eq, sql } from 'drizzle-orm';
import { newId } from '@wa-archive/shared';
import type { Db } from './client.js';
import { media } from './schema.js';

export interface CreateMediaInput {
  messageId: string;
  mediaType: string;
  mimeType: string | null;
  originalFilename: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  fileSize: number | null;
}

/**
 * Media rows and their download lifecycle (spec §19, §23-24). Storage bytes and
 * counts are account-scoped for the storage dashboard (spec §65).
 */
export class MediaRepository {
  constructor(private readonly db: Db) {}

  create(accountId: string, input: CreateMediaInput): string {
    const id = newId();
    this.db
      .insert(media)
      .values({
        id,
        accountId,
        messageId: input.messageId,
        mediaType: input.mediaType,
        mimeType: input.mimeType,
        originalFilename: input.originalFilename,
        width: input.width,
        height: input.height,
        duration: input.duration,
        fileSize: input.fileSize,
        downloadStatus: 'PENDING',
      })
      .run();
    return id;
  }

  get(accountId: string, mediaId: string) {
    return this.db
      .select()
      .from(media)
      .where(and(eq(media.accountId, accountId), eq(media.id, mediaId)))
      .get();
  }

  listByMessage(accountId: string, messageId: string) {
    return this.db
      .select()
      .from(media)
      .where(and(eq(media.accountId, accountId), eq(media.messageId, messageId)))
      .all();
  }

  /** For dedup (spec §22): an already-archived file in this account with this hash. */
  findArchivedBySha(accountId: string, sha256: string) {
    return this.db
      .select()
      .from(media)
      .where(
        and(
          eq(media.accountId, accountId),
          eq(media.sha256, sha256),
          eq(media.downloadStatus, 'ARCHIVED'),
        ),
      )
      .get();
  }

  markDownloading(mediaId: string) {
    this.db
      .update(media)
      .set({ downloadStatus: 'DOWNLOADING' })
      .where(eq(media.id, mediaId))
      .run();
  }

  incrementAttempts(mediaId: string) {
    this.db
      .update(media)
      .set({ downloadAttempts: sql`${media.downloadAttempts} + 1` })
      .where(eq(media.id, mediaId))
      .run();
  }

  markArchived(
    mediaId: string,
    patch: { storagePath: string; sha256: string; fileSize: number; thumbnailPath: string | null },
  ) {
    this.db
      .update(media)
      .set({
        storagePath: patch.storagePath,
        sha256: patch.sha256,
        fileSize: patch.fileSize,
        thumbnailPath: patch.thumbnailPath,
        downloadStatus: 'ARCHIVED',
        archivedAt: Date.now(),
      })
      .where(eq(media.id, mediaId))
      .run();
  }

  markFailed(mediaId: string) {
    this.db.update(media).set({ downloadStatus: 'FAILED' }).where(eq(media.id, mediaId)).run();
  }

  /** Rows needing (re)download on startup — PENDING/DOWNLOADING left mid-flight. */
  listPending(accountId: string) {
    return this.db
      .select()
      .from(media)
      .where(
        and(
          eq(media.accountId, accountId),
          sql`${media.downloadStatus} IN ('PENDING','DOWNLOADING')`,
        ),
      )
      .all();
  }

  listByAccount(accountId: string, mediaType?: string) {
    const cond = mediaType
      ? and(eq(media.accountId, accountId), eq(media.mediaType, mediaType))
      : eq(media.accountId, accountId);
    return this.db.select().from(media).where(cond).orderBy(sql`${media.createdAt} DESC`).all();
  }

  countByAccount(accountId: string): number {
    const r = this.db
      .select({ n: sql<number>`count(*)` })
      .from(media)
      .where(eq(media.accountId, accountId))
      .get();
    return r?.n ?? 0;
  }

  /** Physical bytes actually archived, counting each stored file once (spec §65). */
  storageBytesByAccount(accountId: string): number {
    const r = this.db
      .select({ n: sql<number>`COALESCE(SUM(file_size), 0)` })
      .from(media)
      .where(and(eq(media.accountId, accountId), eq(media.downloadStatus, 'ARCHIVED')))
      .get();
    return r?.n ?? 0;
  }
}
