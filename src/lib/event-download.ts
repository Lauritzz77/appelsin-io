// HMAC-signed event-download tokens. Lets a guest open the zip link from an
// email without logging in — the key in the URL is the access control.
// Tokens are tied to the event id and never expire on their own; once the
// event row is deleted (retention cleanup), the URL just 404s.

function bytesToBase64Url(bytes: Uint8Array): string {
	let s = ''
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array | null {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((value.length + 3) % 4)
	try {
		const bin = atob(padded)
		const out = new Uint8Array(bin.length)
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
		return out
	} catch {
		return null
	}
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	)
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
	return new Uint8Array(sig)
}

export async function signEventDownload(eventId: string, secret: string): Promise<string> {
	return bytesToBase64Url(await hmac(secret, `event-download:${eventId}`))
}

export async function verifyEventDownload(
	eventId: string,
	key: string | null | undefined,
	secret: string
): Promise<boolean> {
	if (!key) return false
	const provided = base64UrlToBytes(key)
	if (!provided) return false
	const expected = await hmac(secret, `event-download:${eventId}`)
	if (provided.length !== expected.length) return false
	let diff = 0
	for (let i = 0; i < expected.length; i++) diff |= provided[i] ^ expected[i]
	return diff === 0
}

export async function eventDownloadUrl(
	baseUrl: string,
	eventId: string,
	secret: string
): Promise<string> {
	const key = await signEventDownload(eventId, secret)
	return `${baseUrl}/api/events/${eventId}/download?key=${key}`
}
