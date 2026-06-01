import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { verifyGuest } from '../../lib/guest-auth'
import type { NewPhotoMessage } from '../../worker-entry'

export const prerender = false

// Called by the guest upload island after a successful direct upload to CF Images.
// Inserts a photo row + notifies the per-event Durable Object so connected
// display clients receive the new photo over WebSocket.
export const POST: APIRoute = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as
		| { code?: string; cfImagesId?: string; userId?: string; token?: string }
		| null
	const code = body?.code?.toUpperCase()
	const cfImagesId = body?.cfImagesId

	if (!code || !cfImagesId) return new Response('Missing code or cfImagesId', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({ id: schema.events.id, status: schema.events.status })
		.from(schema.events)
		.where(eq(schema.events.shortCode, code))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })
	if (event.status !== 'live') return new Response('Event not live', { status: 403 })

	const user = await verifyGuest(db, event.id, body?.userId, body?.token)
	if (!user) return new Response('Unauthorized', { status: 401 })

	const photoId = crypto.randomUUID()
	await db.insert(schema.photos).values({
		id: photoId,
		eventId: event.id,
		eventUserId: user.id,
		cfImagesId,
		status: 'approved',
	})

	const stubId = env.EVENT_CHANNEL.idFromName(event.id)
	const stub = env.EVENT_CHANNEL.get(stubId)
	const payload: NewPhotoMessage = {
		type: 'new-photo',
		photoId,
		mediaType: 'photo',
		cfImagesId,
		cfStreamUid: null,
		durationSeconds: null,
		createdAt: Date.now(),
		uploaderName: user.name ?? null,
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

	return Response.json({ ok: true, photoId })
}
