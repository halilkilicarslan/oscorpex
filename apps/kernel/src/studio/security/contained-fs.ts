// ---------------------------------------------------------------------------
// Symlink-race-safe file access inside a tenant repo. A repo is attacker-writable while the kernel works on it, so a
// check ("is this path inside the repo?") followed by a use (open/read/write/mkdir) can be raced by swapping a path
// component for a symlink in between. These helpers close that window:
//   1. lexical containment first (resolve + separator, never a bare startsWith);
//   2. the parent directory is resolved with realpath and must be inside the real root;
//   3. the leaf is opened with O_NOFOLLOW (a symlink leaf fails with ELOOP);
//   4. the *opened descriptor* is verified: Linux reads /proc/self/fd/N, elsewhere (macOS) the path is re-resolved
//      and must be the very same file (dev/ino) as the descriptor and still inside the root. A parent directory that
//      was swapped after step 2 is therefore caught before a single byte is read or written.
// Directories are created one segment at a time and only after the segment passed the containment check, so no
// directory is ever created outside the root through a planted link.
// Residual: a parent swapped *during* the segment walk can still make one mkdir land outside; the descriptor check
// then rejects the write. I2 removes kernel access to tenant repos altogether.
// ---------------------------------------------------------------------------

import { constants, realpathSync } from "node:fs";
import { type FileHandle, lstat, mkdir, open, readdir, readlink, realpath, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export class PathContainmentError extends Error {
	constructor(message = "Invalid file path — traversal detected") {
		super(message);
		this.name = "PathContainmentError";
	}
}

function inside(root: string, p: string): boolean {
	return p === root || p.startsWith(root + sep);
}

/** Lexical containment: `rel` must resolve to a path under `root` (and not be absolute). */
function lexicalTarget(root: string, rel: string): string {
	if (isAbsolute(rel) || rel.includes("\0")) throw new PathContainmentError();
	const full = resolve(root, rel);
	if (!inside(resolve(root), full)) throw new PathContainmentError();
	return full;
}

/** Real path of the directory that will hold `full`; must be inside `realRoot`. */
async function containedParent(realRoot: string, full: string): Promise<string> {
	const parent = await realpath(dirname(full));
	if (!inside(realRoot, parent)) throw new PathContainmentError();
	return parent;
}

/** Verifies that `fh` really is a file inside `realRoot` (see header, step 4). */
async function verifyHandle(fh: FileHandle, full: string, realRoot: string): Promise<void> {
	if (process.platform === "linux") {
		try {
			const actual = await readlink(`/proc/self/fd/${fh.fd}`);
			if (!inside(realRoot, actual)) throw new PathContainmentError();
			return;
		} catch (err) {
			if (err instanceof PathContainmentError) throw err;
			// /proc unavailable: fall through to the portable check
		}
	}
	const real = await realpath(full);
	if (!inside(realRoot, real)) throw new PathContainmentError();
	const [a, b] = await Promise.all([fh.stat(), stat(real)]);
	if (a.dev !== b.dev || a.ino !== b.ino) throw new PathContainmentError("File changed while opening");
}

interface ParentDir {
	/** Path under which the entry `name` of the verified parent can be addressed without re-walking the tree. */
	entry(name: string): string;
	close(): Promise<void>;
}

/**
 * The (verified) parent directory of `full`. Linux: the directory is opened O_DIRECTORY|O_NOFOLLOW, its real path
 * is checked through /proc/self/fd, and every later operation goes through `/proc/self/fd/<fd>/<name>`, so swapping
 * the parent for a symlink afterwards cannot redirect it. Elsewhere: the realpath'd parent plus the basename.
 */
async function openParent(realRoot: string, full: string): Promise<ParentDir> {
	const parent = await containedParent(realRoot, full);
	if (process.platform !== "linux") return { entry: (name) => join(parent, name), close: async () => {} };
	let fh: FileHandle;
	try {
		fh = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | O_NOFOLLOW);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ELOOP" || (err as NodeJS.ErrnoException).code === "ENOTDIR") {
			throw new PathContainmentError("Parent directory changed while opening");
		}
		throw err;
	}
	try {
		const actual = await readlink(`/proc/self/fd/${fh.fd}`);
		if (!inside(realRoot, actual)) throw new PathContainmentError();
	} catch (err) {
		await fh.close();
		if (err instanceof PathContainmentError) throw err;
		// /proc unavailable: portable fallback
		return { entry: (name) => join(parent, name), close: async () => {} };
	}
	return { entry: (name) => `/proc/self/fd/${fh.fd}/${name}`, close: () => fh.close() };
}

async function openVerified(root: string, rel: string, flags: number, mode?: number): Promise<FileHandle> {
	const full = lexicalTarget(root, rel);
	const realRoot = await realpath(root);
	const parent = await openParent(realRoot, full);
	try {
		const target = parent.entry(basename(full));
		// A pre-existing symlink leaf is refused up front (O_NOFOLLOW below also covers a swap after this check).
		let existed = true;
		try {
			if ((await lstat(full)).isSymbolicLink()) throw new PathContainmentError("Symbolic links are not followed");
		} catch (err) {
			if (err instanceof PathContainmentError) throw err;
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
			existed = false;
		}
		// O_NONBLOCK: opening a FIFO must not block; the fstat below then refuses it
		const fh = await open(target, flags | O_NOFOLLOW | constants.O_NONBLOCK, mode);
		try {
			await verifyHandle(fh, full, realRoot);
			if (!(await fh.stat()).isFile()) throw new PathContainmentError("Not a regular file");
		} catch (err) {
			await fh.close();
			if (!existed) await unlink(target).catch(() => undefined); // never leave a stray file we just created
			throw err;
		}
		return fh;
	} finally {
		await parent.close();
	}
}

export interface ContainedRead {
	data: Buffer;
	mode: number;
}

/** Reads a regular file under `root`; never follows a symlink leaf or a redirected parent. */
export async function readContainedFile(root: string, rel: string): Promise<ContainedRead> {
	const fh = await openVerified(root, rel, constants.O_RDONLY);
	try {
		const st = await fh.stat();
		return { data: await fh.readFile(), mode: st.mode & 0o777 };
	} finally {
		await fh.close();
	}
}

/**
 * Creates every missing directory of `relDir` under `root`, one segment at a time. A segment that is a symlink must
 * resolve inside the real root; nothing is created before its parent passed the check.
 */
export async function ensureContainedDir(root: string, relDir: string): Promise<string> {
	const realRoot = await realpath(root);
	const target = lexicalTarget(root, relDir || ".");
	let cur = realRoot;
	for (const seg of relative(resolve(root), target).split(sep).filter(Boolean)) {
		const next = join(cur, seg);
		let st: Awaited<ReturnType<typeof lstat>> | undefined;
		try {
			st = await lstat(next);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
		}
		if (!st) {
			await mkdir(next); // non-recursive: fails (EEXIST) instead of following a link that appeared meanwhile
			cur = next;
			continue;
		}
		if (st.isSymbolicLink()) {
			const real = await realpath(next);
			if (!inside(realRoot, real)) throw new PathContainmentError();
			cur = real;
			continue;
		}
		if (!st.isDirectory()) throw new PathContainmentError("Path component is not a directory");
		cur = next;
	}
	return cur;
}

export interface ContainedWriteOptions {
	/** Create missing parent directories (after the containment check). */
	mkdirs?: boolean;
	/** Fail when the file already exists. */
	exclusive?: boolean;
	/** Mode for a newly created file, and chmod target when `applyMode` is set. */
	mode?: number;
	applyMode?: boolean;
}

/** Writes `data` to `rel` under `root`; the file is only truncated after the opened descriptor was verified. */
export async function writeContainedFile(
	root: string,
	rel: string,
	data: string | Uint8Array,
	opts: ContainedWriteOptions = {},
): Promise<void> {
	const full = lexicalTarget(root, rel);
	if (opts.mkdirs) await ensureContainedDir(root, relative(resolve(root), dirname(full)));
	const flags = constants.O_WRONLY | constants.O_CREAT | (opts.exclusive ? constants.O_EXCL : 0);
	const fh = await openVerified(root, rel, flags, opts.mode ?? 0o644);
	try {
		await fh.truncate(0);
		await fh.writeFile(data);
		if (opts.applyMode && opts.mode !== undefined) await fh.chmod(opts.mode);
	} finally {
		await fh.close();
	}
}

/** Removes a file under `root` (a symlink leaf is unlinked itself, never followed). */
export async function removeContainedFile(root: string, rel: string): Promise<void> {
	const full = lexicalTarget(root, rel);
	const parent = await openParent(await realpath(root), full);
	try {
		await unlink(parent.entry(basename(full)));
	} finally {
		await parent.close();
	}
}

/** lstat of an entry under `root` (a symlink leaf is reported as such, a redirected parent is refused). */
export async function statContainedFile(root: string, rel: string) {
	const full = lexicalTarget(root, rel);
	const parent = await openParent(await realpath(root), full);
	try {
		return await lstat(parent.entry(basename(full)));
	} finally {
		await parent.close();
	}
}

/** Lists a directory under `root`; any symlinked segment on the way is refused. */
export async function readContainedDir(root: string, relDir: string) {
	const full = lexicalTarget(root, relDir || ".");
	const realRoot = await realpath(root);
	let cur = resolve(root);
	for (const seg of relative(cur, full).split(sep).filter(Boolean)) {
		cur = join(cur, seg);
		if ((await lstat(cur)).isSymbolicLink()) throw new PathContainmentError("Symbolic links are not followed");
	}
	if (!inside(realRoot, await realpath(full))) throw new PathContainmentError();
	return readdir(full, { withFileTypes: true });
}

/**
 * Physical containment of a working directory: both paths are realpath'd and the real cwd must equal or lie inside the
 * real root (resolve + separator, never a bare startsWith). Child processes (installs, app starts) run from, and tools
 * such as yarn walk up from, the PHYSICAL directory, so a service dir that is a symlink out of (or around inside) the
 * repo must be judged by where it really is. Returns the real paths; callers should spawn with `realCwd`.
 */
export function resolveContainedCwd(root: string, cwd: string): { realRoot: string; realCwd: string } {
	let realRoot: string;
	let realCwd: string;
	try {
		realRoot = realpathSync(root);
		realCwd = realpathSync(cwd);
	} catch {
		throw new PathContainmentError("Service directory does not exist");
	}
	if (!inside(realRoot, realCwd)) throw new PathContainmentError("Service directory escapes the repository");
	return { realRoot, realCwd };
}
