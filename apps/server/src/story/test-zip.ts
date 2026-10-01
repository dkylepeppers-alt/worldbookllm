import { crc32, deflateRawSync } from 'node:zlib';

/** One file for `makeZip`: deflated unless `store`; `symlink` marks it as a Unix symlink. */
export interface TestZipEntry {
  name: string;
  data?: string | Buffer;
  store?: boolean;
  symlink?: boolean;
  /** Name bytes written without the UTF-8 flag, as older tools write CP437 names. */
  legacyName?: Buffer;
}

/** Writes a minimal zip archive for tests (the inverse of project-zip's reader). */
export function makeZip(entries: readonly TestZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = entry.legacyName ?? Buffer.from(entry.name, 'utf8');
    const flags = entry.legacyName ? 0 : 0x800;
    const data = Buffer.from(entry.data ?? '');
    const body = entry.store ? data : deflateRawSync(data);
    const method = entry.store ? 0 : 8;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = entry.symlink ? 0o120777 : entry.name.endsWith('/') ? 0o40755 : 0o100644;
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
