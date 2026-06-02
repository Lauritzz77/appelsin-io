/**
 * Validate a user-supplied `next` / redirect target so it can only ever point
 * at a same-origin path. Rejects protocol-relative ("//evil.com"), backslash
 * tricks ("/\\evil.com") and absolute/scheme URLs, falling back to `fallback`.
 */
export function safeNext(raw: string | null | undefined, fallback: string): string {
	if (!raw) return fallback
	if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
	try {
		const u = new URL(raw, 'https://placeholder.invalid')
		if (u.origin !== 'https://placeholder.invalid') return fallback
	} catch {
		return fallback
	}
	return raw
}
