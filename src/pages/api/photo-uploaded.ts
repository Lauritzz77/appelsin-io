import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { TIERS, isTier } from '../../lib/tiers'
import { verifyGuest } from '../../lib/guest-auth'
import { countActiveMedia, notifyEventChannel } from '../../lib/event-media'
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
		.select({
			id: schema.events.id,
			status: schema.events.status,
			tier: schema.events.tier,
			moderationMode: schema.events.moderationMode,
		})
		.from(schema.events)
		.where(eq(schema.events.shortCode, code))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })
	if (event.status !== 'live') return new Response('Event not live', { status: 403 })

	const user = await verifyGuest(db, event.id, body?.userId, body?.token)
	if (!user) return new Response('Unauthorized', { status: 401 })

	// Bind the asset to this event: the image must carry the eventId we stamped
	// on it at mint time (upload-url.ts). Without this a guest could confirm an
	// arbitrary in-account cfImagesId — including another event's photo.
	const imgRes = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${env.CF_IMAGES_ACCOUNT_ID}/images/v1/${cfImagesId}`,
		{ headers: { Authorization: `Bearer ${env.CF_IMAGES_API_TOKEN}` } }
	)
	const imgData = (await imgRes.json().catch(() => null)) as
		| { result?: { meta?: { eventId?: string } } }
		| null
	if (!imgRes.ok || imgData?.result?.meta?.eventId !== event.id) {
		return new Response('Image does not belong to this event', { status: 403 })
	}

	// Re-check the tier photo cap on the authoritative write path; the mint-time
	// check in upload-url.ts can be raced or skipped by calling this directly.
	const tier = isTier(event.tier) ? event.tier : 'free'
	const photoCap = TIERS[tier].photoCap
	const count = await countActiveMedia(db, event.id)
	if (count >= photoCap) {
		return Response.json(
			{
				error: 'cap_reached',
				message: `This event has reached its limit of ${photoCap.toLocaleString('en-IE')} photos.`,
				count,
				cap: photoCap,
			},
			{ status: 429 }
		)
	}

	// When the host has moderation on (queue), hold the photo as pending and do
	// NOT broadcast it — it reaches the wall only once the host approves it.
	const status = event.moderationMode === 'queue' ? 'pending' : 'approved'

	const photoId = crypto.randomUUID()
	await db.insert(schema.photos).values({
		id: photoId,
		eventId: event.id,
		eventUserId: user.id,
		cfImagesId,
		status,
	})

	if (status === 'approved') {
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
		await notifyEventChannel(env, event.id, payload)
	}

	return Response.json({ ok: true, photoId, status })
}
