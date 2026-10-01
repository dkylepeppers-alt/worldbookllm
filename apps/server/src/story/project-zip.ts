import { crc32, inflateRawSync } from 'node:zlib';

import { InvalidImportError } from '../errors.js';

/** Limits for a project archive; the upload itself is capped at 25 MiB by the route. */
export const PROJECT_ZIP_LIMITS = {
  maxEntries: 5_000,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
} as const;

/** Files a story-skills project is made of: Markdown, plain notes, and cover images. */
const KEPT_EXTENSIONS = new Set(['md', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'webp']);

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;

interface ZipEntry {
  name: string;
  directory: boolean;
  symlink: boolean;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

function invalid(message: string): InvalidImportError {
  return new InvalidImportError(message);
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const lowest = Math.max(0, bytes.length - EOCD_SIZE - MAX_COMMENT);
  for (let at = bytes.length - EOCD_SIZE; at >= lowest; at -= 1) {
    if (bytes.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  throw invalid('The upload is not a zip archive.');
}

/**
 * Reads a zip archive's central directory. Only what a project archive needs
 * is supported: stored and deflated entries in a single-disk, non-ZIP64,
 * unencrypted archive. Entries are listed, not decompressed.
 */
function listEntries(bytes: Buffer): ZipEntry[] {
  if (bytes.length < EOCD_SIZE) throw invalid('The upload is not a zip archive.');
  const end = findEndOfCentralDirectory(bytes);
  const disk = bytes.readUInt16LE(end + 4);
  const directoryDisk = bytes.readUInt16LE(end + 6);
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (disk !== 0 || directoryDisk !== 0) throw invalid('Split zip archives are not supported.');
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw invalid('ZIP64 archives are not supported.');
  }
  if (count > PROJECT_ZIP_LIMITS.maxEntries) {
    throw invalid(`The archive has more than ${PROJECT_ZIP_LIMITS.maxEntries} entries.`);
  }
  if (directoryOffset + directorySize > end) throw invalid('The zip archive is damaged.');

  const entries: ZipEntry[] = [];
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw invalid('The zip archive is damaged.');
    }
    const madeBy = bytes.readUInt16LE(at + 4);
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const externalAttributes = bytes.readUInt32LE(at + 38);
    const localOffset = bytes.readUInt32LE(at + 42);
    const nameEnd = at + 46 + nameLength;
    if (nameEnd > end) throw invalid('The zip archive is damaged.');
    // Bit 11: the name is UTF-8. Older tools write CP437; its ASCII range is all a project uses.
    const name = bytes.toString(flags & 0x800 ? 'utf8' : 'latin1', at + 46, nameEnd);
    if (flags & 0x1) throw invalid('Encrypted zip archives are not supported.');
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw invalid('ZIP64 archives are not supported.');
    }
    const unixMode = madeBy >> 8 === 3 ? externalAttributes >>> 16 : 0;
    entries.push({
      name,
      directory: name.endsWith('/'),
      symlink: (unixMode & 0o170000) === 0o120000,
      method,
      crc,
      compressedSize,
      size,
      localOffset,
    });
    at = nameEnd + extraLength + commentLength;
  }
  return entries;
}

/** Decompresses one entry, never producing more than its declared size, and checks its CRC. */
function readEntry(bytes: Buffer, entry: ZipEntry): Buffer {
  const at = entry.localOffset;
  if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== LOCAL_SIGNATURE) {
    throw invalid(`The zip archive is damaged at ${entry.name}.`);
  }
  const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
  const stop = start + entry.compressedSize;
  if (stop > bytes.length) throw invalid(`The zip archive is damaged at ${entry.name}.`);
  const raw = bytes.subarray(start, stop);
  let data: Buffer;
  if (entry.method === 0) {
    data = raw;
  } else if (entry.method === 8) {
    try {
      data = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size) });
    } catch {
      throw invalid(`${entry.name} could not be decompressed.`);
    }
  } else {
    throw invalid(`${entry.name} uses an unsupported compression method.`);
  }
  if (data.length !== entry.size || crc32(data) !== entry.crc) {
    throw invalid(`${entry.name} is damaged (size or checksum mismatch).`);
  }
  return data;
}

/** A path inside the archive as POSIX segments, or null when it could escape the project. */
function safeSegments(name: string): string[] | null {
  if (
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[a-z]:/iu.test(name)
  ) {
    return null;
  }
  const segments = name.split('/').filter((segment) => segment !== '' && segment !== '.');
  return segments.some((segment) => segment === '..') ? null : segments;
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

interface ProjectArchiveFile {
  /** Book-relative POSIX path. */
  path: string;
  data: Buffer;
}

export interface ProjectArchive {
  files: ProjectArchiveFile[];
  /** Archive paths that were left out, each with the reason. */
  skipped: string[];
}

/**
 * Unpacks a zipped story-skills project (ADR 0020). The project root is the
 * folder holding `story.md`: the archive root, or a single top-level folder.
 * Markdown, plain-text notes, and cover images are kept; build output
 * (`dist/`), dot-entries, macOS resource forks, symlinks, and other file
 * types are skipped and reported. An entry whose path could escape the
 * project rejects the whole archive.
 */
export function unpackProjectZip(bytes: Buffer): ProjectArchive {
  const entries = listEntries(bytes);
  const files: Array<{ entry: ZipEntry; segments: string[] }> = [];
  for (const entry of entries) {
    const segments = safeSegments(entry.name);
    if (segments === null) {
      throw invalid(`The archive contains an unsafe path: ${entry.name}`);
    }
    if (!entry.directory && segments.length > 0) files.push({ entry, segments });
  }

  const roots = new Set(
    files
      .filter(({ segments }) => segments.at(-1) === 'story.md')
      .map(({ segments }) => segments.slice(0, -1).join('/')),
  );
  let root: string;
  if (roots.has('')) {
    root = '';
  } else if (roots.size === 1) {
    root = [...roots][0]!;
    if (root.includes('/')) {
      throw invalid('Zip the book folder itself: story.md must be at the top of the archive.');
    }
  } else if (roots.size === 0) {
    throw invalid('The archive is not a story-skills project: it has no story.md.');
  } else {
    throw invalid('The archive holds several books. Import them one zip at a time.');
  }

  const kept: Array<{ entry: ZipEntry; path: string }> = [];
  const keptPaths = new Set<string>();
  const skipped: string[] = [];
  let total = 0;
  for (const { entry, segments } of files) {
    const inside = root === '' ? segments : segments[0] === root ? segments.slice(1) : null;
    const path = inside?.join('/') ?? '';
    const skip = (reason: string) => skipped.push(`${entry.name} (${reason})`);
    if (segments.some((segment) => segment.startsWith('.') || segment === '__MACOSX')) {
      continue; // Hidden files and resource forks are tool noise, not the writer's content.
    } else if (inside === null || inside.length === 0) {
      skip('outside the book folder');
    } else if (inside[0] === 'dist') {
      skip('build output');
    } else if (entry.symlink) {
      skip('symbolic link');
    } else if (!KEPT_EXTENSIONS.has(extensionOf(path))) {
      skip('not a project file type');
    } else if (entry.size > PROJECT_ZIP_LIMITS.maxFileBytes) {
      throw invalid(`${entry.name} is larger than 25 MiB.`);
    } else if (keptPaths.has(path)) {
      throw invalid(`The archive contains ${entry.name} twice.`);
    } else {
      total += entry.size;
      if (total > PROJECT_ZIP_LIMITS.maxTotalBytes) {
        throw invalid('The archive unpacks to more than 100 MiB.');
      }
      keptPaths.add(path);
      kept.push({ entry, path });
    }
  }

  return {
    files: kept.map(({ entry, path }) => ({ path, data: readEntry(bytes, entry) })),
    skipped,
  };
}
