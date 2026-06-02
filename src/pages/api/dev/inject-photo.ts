import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as schema from '../../../db/schema'
import type { NewPhotoMessage } from '../../../worker-entry'

export const prerender = false

// Dev-only: simulate a new photo arrival for an event without going through
// CF Images. Lets us smoke-test the DO + WebSocket pipeline before image plumbing.
export const POST: APIRoute = async ({ request, locals }) => {
	if (!import.meta.env.DEV) return new Response('Not found', { status: 404 })

	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const { code } = (await request.json()) as { code?: string }
	if (!code) return new Response('Missing code', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select()
		.from(schema.events)
		.where(eq(schema.events.shortCode, code.toUpperCase()))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })
	if (event.hostId !== host.id) return new Response('Not your event', { status: 403 })

	const status = event.moderationMode === 'queue' ? 'pending' : 'approved'
	const photoId = crypto.randomUUID()
	await db.insert(schema.photos).values({
		id: photoId,
		eventId: event.id,
		cfImagesId: null,
		status,
	})

	if (status === 'approved') {
		const stubId = env.EVENT_CHANNEL.idFromName(event.id)
		const stub = env.EVENT_CHANNEL.get(stubId)
		const payload: NewPhotoMessage = {
			type: 'new-photo',
			photoId,
			mediaType: 'photo',
			cfImagesId: null,
			cfStreamUid: null,
			durationSeconds: null,
			createdAt: Date.now(),
			uploaderName: null,
			mediaWidth: null,
			mediaHeight: null,
		}
		await stub.fetch(
			new Request('https://do.local/notify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
		)
	}

	return Response.json({ ok: true, photoId })
}
