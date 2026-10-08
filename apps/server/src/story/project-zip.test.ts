import { describe, expect, it } from 'vitest';

import { InvalidImportError } from '../errors.js';
import { PROJECT_ZIP_LIMITS, unpackProjectZip } from './project-zip.js';
import { makeZip } from './test-zip.js';

const STORY = '---\ntitle: "The Salt Road"\n---\n';

async function paths(bytes: Buffer): Promise<string[]> {
  return (await unpackProjectZip(bytes)).files.map((file) => file.path).sort();
}

describe('unpackProjectZip', () => {
  it('keeps project files at the archive root, stored or deflated', async () => {
    const archive = await unpackProjectZip(
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

  it('strips a single top-level book folder and reports what it skips', async () => {
    const archive = await unpackProjectZip(
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

  it('decodes names written without the UTF-8 flag as CP437', async () => {
    // "Éloïse.md" in CP437: É is 0x90, ï is 0x8b.
    const legacyName = Buffer.from([
      0x72, 0x65, 0x73, 0x65, 0x61, 0x72, 0x63, 0x68, 0x2f, 0x90, 0x6c, 0x6f, 0x8b, 0x73, 0x65,
      0x2e, 0x6d, 0x64,
    ]);
    expect(
      await paths(
        makeZip([
          { name: 'story.md', data: STORY },
          { name: 'unused', legacyName, data: '# Éloïse' },
        ]),
      ),
    ).toEqual(['research/Éloïse.md', 'story.md']);
  });

  it.each([
    ['../evil.md', 'unsafe path'],
    ['/etc/passwd.md', 'unsafe path'],
    ['book/../../evil.md', 'unsafe path'],
    ['book\\evil.md', 'unsafe path'],
    ['C:/evil.md', 'unsafe path'],
  ])('rejects the whole archive for %s', async (name, message) => {
    await expect(
      unpackProjectZip(
        makeZip([
          { name: 'story.md', data: STORY },
          { name, data: 'x' },
        ]),
      ),
    ).rejects.toThrow(message);
  });

  it('keeps the Markdown and text files of an archive without story.md', async () => {
    const archive = await unpackProjectZip(
      makeZip([
        { name: 'draft/chapter-1.md', data: '# Chapter 1' },
        { name: 'draft/notes/harbor.txt', data: 'Fog.' },
        { name: 'draft/cover.png', data: 'png' },
        { name: 'draft/.DS_Store', data: 'x' },
      ]),
    );
    expect(archive.kind).toBe('documents');
    expect(archive.files.map((file) => file.path)).toEqual([
      'draft/chapter-1.md',
      'draft/notes/harbor.txt',
    ]);
    expect(archive.skipped).toEqual(['draft/cover.png (not a Markdown or text file)']);
    await expect(unpackProjectZip(makeZip([{ name: 'cover.png', data: 'x' }]))).rejects.toThrow(
      'no story.md and no Markdown or text files',
    );
  });

  it('rejects archives that are not one story-skills project', async () => {
    await expect(
      unpackProjectZip(
        makeZip([
          { name: 'one/story.md', data: STORY },
          { name: 'two/story.md', data: STORY },
        ]),
      ),
    ).rejects.toThrow('several books');
    await expect(
      unpackProjectZip(
        makeZip([
          { name: 'story.md', data: STORY },
          { name: 'research/old/story.md', data: STORY },
        ]),
      ),
    ).rejects.toThrow('several books');
    await expect(
      unpackProjectZip(makeZip([{ name: 'a/b/story.md', data: STORY }])),
    ).rejects.toThrow('story.md must be at the top');
    await expect(
      unpackProjectZip(
        makeZip([
          { name: 'story.md', data: STORY },
          { name: 'chapters/a.md', data: 'one' },
          { name: './chapters/a.md', data: 'two' },
        ]),
      ),
    ).rejects.toThrow('twice');
  });

  it('rejects data that is not a zip, or is damaged', async () => {
    await expect(unpackProjectZip(Buffer.from('not a zip at all, just text here'))).rejects.toThrow(
      InvalidImportError,
    );
    const archive = makeZip([{ name: 'story.md', data: STORY, store: true }]);
    // Flip a byte of the stored content: the CRC no longer matches.
    archive.writeUInt8(archive.readUInt8(30 + 8) ^ 0xff, 30 + 8);
    await expect(unpackProjectZip(archive)).rejects.toThrow('checksum');
  });

  it('never inflates past the declared size (zip bombs)', async () => {
    const archive = makeZip([
      { name: 'story.md', data: STORY },
      { name: 'chapters/bomb.md', data: Buffer.alloc(1024 * 1024, 0x61) },
    ]);
    // Lie about the uncompressed size in the central directory: 10 bytes.
    const central = archive.indexOf(Buffer.from('chapters/bomb.md'), archive.length - 200) - 46;
    archive.writeUInt32LE(10, central + 24);
    await expect(unpackProjectZip(archive)).rejects.toThrow('could not be decompressed');
  });

  it('enforces the size, entry, and time limits', async () => {
    const big = makeZip([
      { name: 'story.md', data: STORY },
      { name: 'chapters/huge.md', data: Buffer.alloc(PROJECT_ZIP_LIMITS.maxFileBytes + 1) },
    ]);
    await expect(unpackProjectZip(big)).rejects.toThrow('larger than 25 MiB');

    const many = makeZip(
      Array.from({ length: PROJECT_ZIP_LIMITS.maxEntries + 1 }, (_, index) => ({
        name: `research/note-${index}.md`,
        store: true,
      })),
    );
    await expect(unpackProjectZip(many)).rejects.toThrow('more than 5000 entries');
  });
});
