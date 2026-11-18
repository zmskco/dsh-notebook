/**
 * What the notebook's tree shows, and how a file is read back.
 *
 * The format layer, kept apart from the IO that serves it: everything here is
 * pure — which names the editor may open, how a text is counted — and the store
 * in `project.ts` owns the filesystem, the sandbox policy and the listing.
 *
 * **The tree lists everything under the directory.** It used to run an extension
 * allowlist (`md`, `txt`, `json`, …), which hid the code an author works next to and
 * then, after that was widened, still hid every binary — and a tree that hides a
 * file the filesystem has is a tree the user cannot trust: "my file is not there"
 * is the report it produces. So every regular file is listed, and the two questions
 * are answered separately:
 *
 * - **Is it text?** ({@link classifyFileName} + {@link isProbablyText}) — a known
 *   text type is text, a known binary type is binary, and anything else is decided
 *   by its first bytes.
 * - **May it be opened?** A `binary` entry is listed as `binary` and the panel says
 *   why it cannot be previewed, instead of the row being absent.
 *
 * @module notebook/story/manuscript
 */
import { basename } from 'node:path'

/** Deepest nesting the tree descends into. */
export const MAX_TREE_DEPTH = 12
/** Ceiling on files listed for one root, so a huge tree cannot stall the page. */
export const MAX_TREE_ENTRIES = 4_000

/**
 * How many bytes of an unknown file are sniffed to decide whether it is text.
 *
 * One page is enough to meet the NUL byte of an image, an archive or a compiled
 * binary, and small enough that a listing of a few hundred unknown files is one
 * handful of reads rather than a directory-sized download.
 */
export const SNIFF_BYTES = 4_096

/**
 * Extensions the tree accepts without looking at the bytes.
 *
 * This is an optimization and a default, not the boundary: a name outside it is
 * sniffed rather than refused, so a file type nobody listed still opens when its
 * content is text. The one list that *does* refuse is {@link BINARY_EXTENSIONS}.
 */
export const TEXT_EXTENSIONS = new Set([
  // Prose and documents.
  '.md', '.markdown', '.mdx', '.txt', '.text', '.rst', '.adoc', '.asciidoc', '.tex', '.org',
  // Data and configuration.
  '.json', '.jsonl', '.jsonc', '.ndjson', '.json5', '.yml', '.yaml', '.toml', '.ini', '.cfg',
  '.conf', '.properties', '.csv', '.tsv', '.xml', '.env', '.diff', '.patch', '.log', '.map',
  // Markup and style.
  '.html', '.htm', '.xhtml', '.css', '.scss', '.sass', '.less', '.styl', '.svg',
  // Source code.
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue', '.svelte', '.astro',
  '.py', '.rb', '.php', '.go', '.rs', '.java', '.kt', '.kts', '.swift', '.scala', '.groovy',
  '.gradle', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.cs', '.fs', '.fsx', '.lua',
  '.r', '.dart', '.ex', '.exs', '.erl', '.hrl', '.hs', '.clj', '.cljs', '.pl', '.pm', '.zig',
  '.nim', '.jl', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd', '.sql',
  '.graphql', '.gql', '.tf', '.hcl', '.nix', '.cmake', '.mk', '.asm', '.s', '.vim', '.sol',
  '.elm', '.v',
])

/**
 * Extensions the tree never shows, whatever their bytes say.
 *
 * Sniffing would catch most of these anyway — a PNG meets a NUL byte in its
 * header — but a name is free and a read is not: the listing asks the filesystem
 * for a window per unknown file, and images, media and archives are exactly the
 * bulk a workspace of notes accumulates. Everything here is a format whose bytes
 * are not text by construction.
 */
export const BINARY_EXTENSIONS = new Set([
  // Images.
  '.png', '.jpg', '.jpeg', '.jfif', '.gif', '.webp', '.avif', '.bmp', '.ico', '.icns',
  '.tif', '.tiff', '.psd', '.xcf', '.heic', '.heif', '.raw', '.cr2', '.nef',
  // Documents that are containers rather than text.
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  '.epub', '.mobi', '.azw3',
  // Archives and packages.
  '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.tar', '.zst', '.lz4', '.jar', '.war',
  '.apk', '.ipa', '.nupkg', '.vsix', '.deb', '.rpm', '.msi', '.dmg', '.iso', '.squashfs',
  // Compiled and native.
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.class', '.o', '.obj', '.a', '.lib',
  '.pdb', '.pyd', '.pyc', '.pyo', '.node', '.elf', '.pak',
  // Audio and video.
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.oga', '.opus', '.m4a', '.wma', '.mid', '.midi',
  '.mp4', '.m4v', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.mpg', '.mpeg', '.3gp',
  // Fonts.
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.ttc',
  // Databases and binary data sets.
  '.sqlite', '.sqlite3', '.db', '.mdb', '.lmdb', '.parquet', '.avro', '.orc', '.arrow',
  '.npy', '.npz', '.pkl', '.pickle', '.h5', '.hdf5', '.mat', '.sav', '.dta', '.glb', '.fbx',
])

/** How one file name classifies before its bytes are looked at. */
export type FileKind = 'text' | 'binary' | 'unknown'

/**
 * Classify one file by its name.
 *
 * A bare name has no extension at all — the panel names files by title (`第一章`)
 * — and a title is a text file. `.bashrc`-style names are skipped by the listing
 * before this is asked, and a name that starts with a dot has no extension to read
 * here either, so `dot <= 0` is the "no suffix" case.
 * @param path - project-relative path; only its basename is considered.
 * @returns `text`, `binary`, or `unknown` (decide by content).
 */
export function classifyFileName(path: string): FileKind {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'text'
  const extension = name.slice(dot).toLowerCase()
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  if (BINARY_EXTENSIONS.has(extension)) return 'binary'
  return 'unknown'
}

/**
 * Whether a name is a text type as far as its extension goes.
 *
 * `unknown` counts as text: the extension said nothing, so only the bytes can, and
 * that read happens against the file rather than the name. The store sniffs an
 * `unknown` file before deciding what to list it as; a binary type is the only
 * thing this predicate turns down.
 * @param path - project-relative path; only its basename is considered.
 * @returns false only for a name known to be binary.
 */
export function isTextFile(path: string): boolean {
  return classifyFileName(path) !== 'binary'
}

/**
 * Whether a window of bytes looks like text.
 *
 * Two facts decide it, and neither needs the bytes to be UTF-8:
 *
 * - **A NUL byte.** No text format carries one; every binary one this list can
 *   meet — images, archives, executables, fonts, media — does, usually within the
 *   first few dozen bytes.
 * - **A C0 control other than tab, line feed, vertical tab, form feed and carriage
 *   return.** That is the rest of "binary junk" that has no NUL early.
 *
 * Deliberately **not** a UTF-8 validity check: a workspace may hold a Chinese file
 * in GBK or GB18030, which is text a reader expects to open even though it is not
 * UTF-8, and refusing it would hide the author's own notes. The editor decodes
 * whatever the filesystem provider returns.
 * @param head - the first bytes of the file; empty is an empty file, which is text.
 * @returns true when the window passes for text.
 */
export function isProbablyText(head: Uint8Array): boolean {
  for (const byte of head) {
    if (byte === 0) return false
    if (byte < 0x09) return false
    if (byte > 0x0d && byte < 0x20) return false
    if (byte === 0x7f) return false
  }
  return true
}

/** Whether an error means "the file is not there". */
export function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'ENOENT' || code === 'FS_NOT_FOUND'
}

/**
 * Count characters the way a writer counts them: code points, front-matter aside.
 * @param content - the full file text.
 * @returns the code-point count of the body.
 */
export function countChars(content: string): number {
  const withoutFrontMatter = content.startsWith('---')
    ? content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    : content
  return [...withoutFrontMatter].length
}
