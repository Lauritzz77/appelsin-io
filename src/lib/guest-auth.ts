// Guest auth helpers — shared by every endpoint that accepts a guest
// identity (join, photos, upload-url, photo-uploaded). The guest's browser
// holds an opaque `{ userId, token }` pair in localStorage after joining; we
// verify both against the `event_users` row to authorise.

import { drizzle } from 'drizzle-orm/d1'
import { and, eq } from 'drizzle-orm'
import * as schema from '../db/schema'

export type EventUser = {
	id: string
	eventId: string
	name: string
	token: string
}

export const MAX_NAME_LENGTH = 32
export const MAX_EMAIL_LENGTH = 254

// Permissive email check — good enough to reject obvious typos at the input
// boundary. Real verification only happens when we actually send mail.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Trim, lowercase, length-cap an email. Returns null when it doesn't pass the
// basic shape check.
export function normaliseEmail(raw: unknown): string | null {
	if (typeof raw !== 'string') return null
	const cleaned = raw.trim().toLowerCase()
	if (cleaned.length === 0 || cleaned.length > MAX_EMAIL_LENGTH) return null
	if (!EMAIL_RE.test(cleaned)) return null
	return cleaned
}

// Normalise a raw user-typed name to its display form. Strips control chars
// and DEL, collapses inner whitespace, trims, and caps length. Returns null
// if nothing meaningful is left.
export function normaliseDisplayName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null
	const cleaned = raw
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
	if (cleaned.length === 0) return null
	if (cleaned.length > MAX_NAME_LENGTH) return cleaned.slice(0, MAX_NAME_LENGTH)
	return cleaned
}

// Look up an event_user belonging to `eventId` and verify the supplied token
// matches. Returns null on any mismatch — callers should treat that as 401.
export async function verifyGuest(
	db: ReturnType<typeof drizzle<typeof schema>>,
	eventId: string,
	userId: unknown,
	token: unknown
): Promise<EventUser | null> {
	if (typeof userId !== 'string' || typeof token !== 'string') return null
	if (userId.length === 0 || token.length === 0) return null

	const [user] = await db
		.select({
			id: schema.eventUsers.id,
			eventId: schema.eventUsers.eventId,
			name: schema.eventUsers.name,
			token: schema.eventUsers.token,
		})
		.from(schema.eventUsers)
		.where(and(eq(schema.eventUsers.id, userId), eq(schema.eventUsers.eventId, eventId)))
		.limit(1)

	if (!user) return null
	if (user.token !== token) return null
	return user
}
