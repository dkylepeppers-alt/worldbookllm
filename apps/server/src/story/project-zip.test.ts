import { describe, expect, it } from 'vitest';

import { InvalidImportError } from '../errors.js';
import { PROJECT_ZIP_LIMITS, unpackProjectZip } from './project-zip.js';
import { makeZip } from './test-zip.js';

const STORY = '---\ntitle: "The Salt Road"\n---\n';

function paths(bytes: Buffer): string[] {
  return unpackProjectZip(bytes)
    .files.map((file) => file.path)
    .sort();
}

describe('unpackProjectZip', () => {
  it('keeps project files at the archive root, stored or deflated', () => {
    const archive = unpackProjectZip(
      makeZip([
        { name: 'story.md', data: STORY },
        { name: 'characters/', data: '' },
        { name: 'characters/ilse.md', data: '# Ilse\n', store: true },
        { name: 'cover.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      ]),
    );
    expect(archive.files.map((file) => file.path).sort()).toEqual([
      'characters/ilse.md',
      'cover.png',
      'story.md',
    ]);
    expect(archive.files.find((file) => file.path === 'characters/ilse.md')?.data.toString()).toBe(
      '# Ilse\n',
    );
    expect(archive.skipped).toEqual([]);
  });

  it('strips a single top-level book folder and reports what it skips', () => {
    const archive = unpackProjectZip(
      makeZip([
        { name: 'salt-road/story.md', data: STORY },
        { name: 'salt-road/chapters/chapter-01.md', data: '# One\n' },
        { name: 'salt-road/dist/salt-road.epub', data: 'epub' },
        { name: 'salt-road/.git/HEAD', data: 'ref' },
        { name: '__MACOSX/salt-road/._story.md', data: 'fork' },
        { name: 'salt-road/notes.docx', data: 'docx' },
        { name: 'salt-road/link.md', data: 'story.md', symlink: true },
        { name: 'README.md', data: 'readme' },
      ]),
    );
    expect(archive.files.map((file) => file.path).sort()).toEqual([
      'chapters/chapter-01.md',
      'story.md',
    ]);
    expect(archive.skipped).toEqual([
      'salt-road/dist/salt-road.epub (build output)',
      'salt-road/notes.docx (not a project file type)',
      'salt-road/link.md (symbolic link)',
      'README.md (outside the book folder)',
    ]);
  });

  it('prefers story.md at the archive root over nested ones', () => {
    expect(
      paths(
        makeZip([
          { name: 'story.md', data: STORY },
          { name: 'research/old/story.md', data: STORY },
        ]),
      ),
    ).toEqual(['research/old/story.md', 'story.md']);
  });

  it.each([
    ['../evil.md', 'unsafe path'],
    ['/etc/passwd.md', 'unsafe path'],
    ['book/../../evil.md', 'unsafe path'],
    ['book\\evil.md', 'unsafe path'],
    ['C:/evil.md', 'unsafe path'],
  ])('rejects the whole archive for %s', (name, message) => {
    expect(() =>
      unpackProjectZip(
        makeZip([
          { name: 'story.md', data: STORY },
          { name, data: 'x' },
        ]),
      ),
    ).toThrow(message);
  });

  it('rejects archives that are not one story-skills project', () => {
    expect(() => unpackProjectZip(makeZip([{ name: 'notes.md', data: 'x' }]))).toThrow(
      'has no story.md',
    );
    expect(() =>
      unpackProjectZip(
        makeZip([
          { name: 'one/story.md', data: STORY },
          { name: 'two/story.md', data: STORY },
        ]),
      ),
    ).toThrow('several books');
    expect(() => unpackProjectZip(makeZip([{ name: 'a/b/story.md', data: STORY }]))).toThrow(
      'story.md must be at the top',
    );
    expect(() =>
      unpackProjectZip(
        makeZip([
          { name: 'story.md', data: STORY },
          { name: 'chapters/a.md', data: 'one' },
          { name: './chapters/a.md', data: 'two' },
        ]),
      ),
    ).toThrow('twice');
  });

  it('rejects data that is not a zip, or is damaged', () => {
    expect(() => unpackProjectZip(Buffer.from('not a zip at all, just text here'))).toThrow(
      InvalidImportError,
    );
    const archive = makeZip([{ name: 'story.md', data: STORY, store: true }]);
    // Flip a byte of the stored content: the CRC no longer matches.
    archive.writeUInt8(archive.readUInt8(30 + 8) ^ 0xff, 30 + 8);
    expect(() => unpackProjectZip(archive)).toThrow('checksum');
  });

  it('never inflates past the declared size (zip bombs)', () => {
    const archive = makeZip([
      { name: 'story.md', data: STORY },
      { name: 'chapters/bomb.md', data: Buffer.alloc(1024 * 1024, 0x61) },
    ]);
    // Lie about the uncompressed size in the central directory: 10 bytes.
    const central = archive.indexOf(Buffer.from('chapters/bomb.md'), archive.length - 200) - 46;
    archive.writeUInt32LE(10, central + 24);
    expect(() => unpackProjectZip(archive)).toThrow('could not be decompressed');
  });

  it('enforces the size and entry limits before decompressing', () => {
    const big = makeZip([
      { name: 'story.md', data: STORY },
      { name: 'chapters/huge.md', data: Buffer.alloc(PROJECT_ZIP_LIMITS.maxFileBytes + 1) },
    ]);
    expect(() => unpackProjectZip(big)).toThrow('larger than 25 MiB');

    const many = makeZip(
      Array.from({ length: PROJECT_ZIP_LIMITS.maxEntries + 1 }, (_, index) => ({
        name: `research/note-${index}.md`,
        store: true,
      })),
    );
    expect(() => unpackProjectZip(many)).toThrow('more than 5000 entries');
  });
});
