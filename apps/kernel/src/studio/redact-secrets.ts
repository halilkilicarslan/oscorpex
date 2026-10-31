// ---------------------------------------------------------------------------
// Oscorpex — credential redaction for log and error text
// ---------------------------------------------------------------------------

// Userinfo password: everything after `scheme://user:` up to the last `@` before whitespace.
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:)\S*@/gi;
// libpq key-values: any key ending in "password"; value single-quoted (with \' escapes), double-quoted or bare.
const LIBPQ_PASSWORD = /\b([a-z_]*password)(\s*=\s*)(?:'(?:\\.|[^'\\])*'|"[^"]*"|[^\s'"]\S*)/gi;

/** Mask the password of `scheme://user:password@host` URLs and libpq `*password=...` pairs. */
export function redactConnectionStrings(text: string): string {
	return text.replace(URL_PASSWORD, "$1***@").replace(LIBPQ_PASSWORD, "$1=***");
}
