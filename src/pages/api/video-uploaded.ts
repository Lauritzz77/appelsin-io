import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq, ne, and, sql } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { TIERS, isTier } from '../../lib/tiers'
import { verifyGuest } from '../../lib/guest-auth'
import type { NewPhotoMessage } from '../../worker-entry'

export const prerender = false

// Fire-and-forget: ask Cloudflare Stream to generate the downloadable MP4 for
// this video. It takes some time to process; by the time someone downloads
// the event zip, the file should be ready at the customer domain's
// /downloads/default.mp4 URL.
async function enableMp4Download(env: Cloudflare.Env, uid: string): Promise<void> {
	if (!env.CF_STREAM_ACCOUNT_ID || !env.CF_STREAM_API_TOKEN) return
	try {
		await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${env.CF_STREAM_ACCOUNT_ID}/stream/${uid}/downloads`,
			{
				method: 'POST',
				headers: { Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}` },
			}
		)
	} catch (e) {
		console.warn('MP4 download enable failed for', uid, e)
	}
}

async function waitForStreamReady(
	env: Cloudflare.Env,
	uid: string
): Promise<{
	ready: boolean
	width: number | null
	height: number | null
	eventId: string | null
	creator: string | null
}> {
	if (!env.CF_STREAM_ACCOUNT_ID || !env.CF_STREAM_API_TOKEN) {
		return { ready: false, width: null, height: null, eventId: null, creator: null }
	}

	// eventId/creator were stamped at mint time (video-upload-url.ts) and are on
	// the Stream object immediately, even before encoding finishes.
	let eventId: string | null = null
	let creator: string | null = null

	for (let attempt = 0; attempt < 6; attempt++) {
		if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500))
		const res = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${env.CF_STREAM_ACCOUNT_ID}/stream/${uid}`,
			{ headers: { Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}` } }
		)
		if (!res.ok) continue
		const payload = (await res.json().catch(() => null)) as
			| {
					result?: {
						readyToStream?: boolean
						status?: { state?: string }
						input?: { width?: number; height?: number }
						creator?: string
						meta?: { eventId?: string }
					}
			  }
			| null
		if (typeof payload?.result?.creator === 'string') creator = payload.result.creator
		if (typeof payload?.result?.meta?.eventId === 'string') eventId = payload.result.meta.eventId
		const ready =
			payload?.result?.readyToStream === true || payload?.result?.status?.state === 'ready'
		const width = typeof payload?.result?.input?.width === 'number' ? payload.result.input.width : null
		const height = typeof payload?.result?.input?.height === 'number' ? payload.result.input.height : null
		if (ready) return { ready: true, width, height, eventId, creator }
	}
	return { ready: false, width: null, height: null, eventId, creator }
}

export const POST: APIRoute = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as
		| { code?: string; cfStreamUid?: string; userId?: string; token?: string; durationSeconds?: number }
		| null
	const code = body?.code?.toUpperCase()
	const cfStreamUid = body?.cfStreamUid

	if (!code || !cfStreamUid) return new Response('Missing code or cfStreamUid', { status: 400 })

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
	if (event.tier !== 'gold') return new Response('Video is only available on Gold events', { status: 403 })

	const user = await verifyGuest(db, event.id, body?.userId, body?.token)
	if (!user) return new Response('Unauthorized', { status: 401 })

	const { width: mediaWidth, height: mediaHeight, eventId: assetEventId, creator } =
		await waitForStreamReady(env, cfStreamUid)
	// Bind the asset to this event + guest using the meta we stamped at mint
	// time (video-upload-url.ts), so a guest can't confirm an arbitrary uid.
	if (assetEventId !== event.id || creator !== user.id) {
		return new Response('Video does not belong to this event', { status: 403 })
	}

	// Re-check the tier cap on the authoritative write path.
	const tier = isTier(event.tier) ? event.tier : 'free'
	const photoCap = TIERS[tier].photoCap
	const [{ count }] = await db
		.select({ count: sql<number>`count(*)` })
		.from(schema.photos)
		.where(and(eq(schema.photos.eventId, event.id), ne(schema.photos.status, 'rejected')))
	if (count >= photoCap) {
		return Response.json(
			{
				error: 'cap_reached',
				message: `This event has reached its limit of ${photoCap.toLocaleString('en-IE')} uploads.`,
				count,
				cap: photoCap,
			},
			{ status: 429 }
		)
	}

	// Trigger MP4-download generation now so the event-zip can include videos
	// when the host downloads later. Fire-and-forget.
	void enableMp4Download(env, cfStreamUid)

	const status = event.moderationMode === 'queue' ? 'pending' : 'approved'

	const photoId = crypto.randomUUID()
	await db.insert(schema.photos).values({
		id: photoId,
		eventId: event.id,
		eventUserId: user.id,
		cfStreamUid,
		mediaType: 'video',
		durationSeconds:
			typeof body?.durationSeconds === 'number' ? Math.min(15, Math.ceil(body.durationSeconds)) : null,
		mediaWidth,
		mediaHeight,
		status,
	})

	if (status === 'approved') {
		const stubId = env.EVENT_CHANNEL.idFromName(event.id)
		const stub = env.EVENT_CHANNEL.get(stubId)
		const payload: NewPhotoMessage = {
			type: 'new-photo',
			photoId,
			mediaType: 'video',
			cfImagesId: null,
			cfStreamUid,
			durationSeconds:
				typeof body?.durationSeconds === 'number' ? Math.min(15, Math.ceil(body.durationSeconds)) : null,
			createdAt: Date.now(),
			uploaderName: user.name ?? null,
			mediaWidth,
			mediaHeight,
		}
		await stub.fetch(
			new Request('https://do.local/notify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			})
		)
	}

	return Response.json({ ok: true, photoId, status })
}
