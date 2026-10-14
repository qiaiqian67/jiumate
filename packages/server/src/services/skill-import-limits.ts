/**
 * Caps shared by every path that pulls Skill files in from outside the library — the archive
 * upload/download routes and the directory import. One set of numbers, so a limit raised for one
 * entry point cannot quietly leave another behind, and one message, so the failure reads the same
 * wherever the user hit it.
 */
import { HttpError } from "../http/errors.js";

export const MAX_ARCHIVE_FILES = 200;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/**
 * MB as a whole number, for the messages. Derived rather than written out: a limit raised in one
 * place must not leave a stale number in a message beside it — which is exactly what happened when
 * the total moved off 20MB and the upload path kept saying "20MB".
 */
const mb = (bytes: number): string => String(Math.round(bytes / 1024 / 1024));

export function skillTooLarge(): HttpError {
  return new HttpError(
    413,
    "skill_too_large",
    `Skill directory exceeds the archive limits (${MAX_ARCHIVE_FILES} files, ${mb(MAX_FILE_BYTES)}MB per file, ${mb(MAX_TOTAL_BYTES)}MB total).`,
  );
}

/** The one wording for "this archive is too big", so the download and upload paths cannot diverge.
 *  Takes the caller's own cap so it names the limit *that* path enforces. */
export function archiveTooLarge(limitBytes: number = MAX_TOTAL_BYTES): string {
  return `压缩包超过 ${mb(limitBytes)}MB 上限。`;
}
