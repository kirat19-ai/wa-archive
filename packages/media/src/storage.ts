import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { folderForMediaType } from './hash.js';

/**
 * Storage abstraction (spec §114) so a cloud backend can be added later without
 * touching the pipeline. `storagePath` values persisted in the DB are always
 * RELATIVE to the storage root, so the archive folder can be relocated (spec §65).
 */
export interface ArchiveStorage {
  /** Persist bytes and return the relative storage path recorded in the DB. */
  save(accountId: string, mediaType: string, mediaId: string, ext: string, data: Buffer): Promise<string>;
  saveThumbnail(accountId: string, mediaId: string, data: Buffer): Promise<string>;
  /** Write bytes at an exact relative path (used by restore, spec §63). */
  writeRaw(relativePath: string, data: Buffer): Promise<void>;
  absolutePath(relativePath: string): string;
  exists(relativePath: string): boolean;
  read(relativePath: string): Promise<Buffer>;
  remove(relativePath: string): Promise<void>;
}

/**
 * Local filesystem storage (spec §21):
 *   <root>/accounts/<accountId>/media/{images,videos,audio,voice,documents,stickers,thumbnails}
 * Files are keyed by mediaId + safe extension, never the original filename.
 */
export class LocalArchiveStorage implements ArchiveStorage {
  constructor(private readonly root: string) {}

  private rel(accountId: string, sub: string, filename: string): string {
    return join('accounts', accountId, 'media', sub, filename);
  }

  async save(
    accountId: string,
    mediaType: string,
    mediaId: string,
    ext: string,
    data: Buffer,
  ): Promise<string> {
    const relPath = this.rel(accountId, folderForMediaType(mediaType), `${mediaId}.${ext}`);
    await this.writeAbs(relPath, data);
    return relPath;
  }

  async saveThumbnail(accountId: string, mediaId: string, data: Buffer): Promise<string> {
    const relPath = this.rel(accountId, 'thumbnails', `${mediaId}.jpg`);
    await this.writeAbs(relPath, data);
    return relPath;
  }

  async writeRaw(relativePath: string, data: Buffer): Promise<void> {
    await this.writeAbs(relativePath, data);
  }

  absolutePath(relativePath: string): string {
    return join(this.root, relativePath);
  }
  exists(relativePath: string): boolean {
    return existsSync(this.absolutePath(relativePath));
  }
  read(relativePath: string): Promise<Buffer> {
    return readFile(this.absolutePath(relativePath));
  }
  async remove(relativePath: string): Promise<void> {
    await rm(this.absolutePath(relativePath), { force: true });
  }

  private async writeAbs(relPath: string, data: Buffer): Promise<void> {
    const abs = this.absolutePath(relPath);
    const dir = dirname(abs);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await writeFile(abs, data);
  }
}
