# ADR 0020 — Build into dist/ and import project zips with an in-house reader

**Status:** accepted · 2026-10-01 · builds on ADR 0014

## Context

M7's "done when" ends with building an EPUB, and ADR 0014 promised that "a zipped story-skills project is imported whole and validated." Neither existed: no route ran `story build`, and the only way to bring a book in whole was to copy its folder into `data/` by hand.

`story build` already writes deterministic, disposable files to the book's `dist/` folder, which the index, checkpoints, and staging ignore. A zip upload is untrusted input: its entry names can point outside the target folder, its compressed sizes can hide gigabytes, and it can carry symlinks, build output, and tool noise (`.git/`, `__MACOSX/`).

## Decision

1. **Builds stay in `dist/` and outside history.** `POST /api/books/:book/builds` runs `story build` under the book lock with a 120 s timeout, passing only `format` and the format's own option (`shunn` for docx, `trim` for print, `stamp` for html). `--out` stays server-owned, so output always lands at the CLI's default `dist/<story-id>.<ext>`. Builds make no checkpoint. A build that exits 1 because `story.md` promotes one of its warnings to an error still wrote its file, so the file is returned with those findings. Builds can be listed, downloaded, and deleted, all under the book lock, and only direct children of `dist/` are served.
2. **Downloads never render.** A build file is sent as an attachment with `nosniff` and a `sandbox` CSP, so an HTML review copy cannot run as a page of the app's origin.
3. **`POST /api/books/import` accepts a `.zip` as a whole project.** The project root is the folder holding `story.md`: either the archive root or a single top-level folder. An archive with more than one `story.md` is refused as holding several books. Markdown, `.txt` notes, and cover images are kept. `dist/`, symlinks, and other file types are skipped and listed in the import report, and dot-entries and `__MACOSX/` are dropped silently. Any entry whose path could leave the project rejects the whole archive.
4. **The archive becomes a standalone book.** Series links in `story.md` are removed, because the archive's siblings are not in this library. The files are written into a hidden folder beside the books, registries are regenerated with `story reindex` (if a file does not parse, reindex cannot run, and the report says so), and the project is validated. Only then is the folder renamed into `data/projects/<slug>/`. Validation findings do not block the import; they are reported, and the Health tab shows them.
5. **The zip reader is in-house** (`src/story/project-zip.ts`). It reads the central directory and supports stored and deflated entries in single-disk, non-ZIP64, unencrypted archives, decoding names as UTF-8 when flagged and as CP437 otherwise. It inflates each entry asynchronously, off the request thread, with `zlib`'s `maxOutputLength` set to the entry's declared size, and checks the CRC. Limits: 5,000 entries, 25 MiB per file, 100 MiB unpacked in total, and 30 seconds to unpack, on top of the 25 MiB upload cap. Writing, promoting, and discarding the staged folder also live in `src/story/`, which keeps book-file access out of the services.

## Rationale

Inflating with `maxOutputLength` caps memory at the declared size, so a zip bomb fails rather than expanding. The zip libraries we looked at allocate from the declared sizes and leave the cap to the caller. The subset a project archive needs is about 150 lines on top of `node:zlib`, with no new dependency to audit. Renaming a fully written folder into place means a failed import never leaves a half-made book in the library.

## Consequences

- ZIP64 and encrypted archives are refused with a clear message. A book over 4 GiB or with 65,535 or more entries could not be uploaded anyway.
- Importing a whole series from one zip, and exporting a book as a zip, are still to do. The reader is shaped so that a series import can reuse it.
- An imported project can carry validation errors from wherever it came from. The writer fixes them in the app, as with any other book.
