// Server-side mechanics shared by the guest media write-path. Two things every
// upload / moderation endpoint was doing inline, now defined once:
//   - countActiveMedia: how many uploads count against an event's tier cap.
//   - notifyEventChannel: push a message to the event's display Durable Object.
// Policy (the cap value, the 429 copy, what message to send and whether to send
// it) stays in the calling route — these are just the repeated mechanics.

import { drizzle } from 'drizzle-orm/d1'
import { and, eq, ne, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { NewPhotoMessage, DeletePhotoMessage } from '../worker-entry'

// Count the media that counts against the tier cap: every photo/video on the
// event except rejected ones. Single source of truth for "what's a live upload"
// so the mint-time check, the write-path re-check and the host dashboard agree.
export async function countActiveMedia(
	db: ReturnType<typeof drizzle<typeof schema>>,
	eventId: string
): Promise<number> {
	const [{ count }] = await db
		.select({ count: sql<number>`count(*)` })
		.from(schema.photos)
		.where(and(eq(schema.photos.eventId, eventId), ne(schema.photos.status, 'rejected')))
	return count
}

// Fan a message out to the connected display clients for one event by POSTing
// to its EventChannel Durable Object. The DO broadcasts to its open WebSockets.
export async function notifyEventChannel(
	env: Cloudflare.Env,
	eventId: string,
	message: NewPhotoMessage | DeletePhotoMessage
): Promise<void> {
	const stub = env.EVENT_CHANNEL.get(env.EVENT_CHANNEL.idFromName(eventId))
	await stub.fetch(
		new Request('https://do.local/notify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(message),
		})
	)
}
