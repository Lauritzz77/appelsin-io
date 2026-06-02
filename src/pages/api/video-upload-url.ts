import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { TIERS, isTier } from '../../lib/tiers'
import { verifyGuest } from '../../lib/guest-auth'
import { countActiveMedia } from '../../lib/event-media'

export const prerender = false

const UPLOAD_OPENS_BEFORE_EVENT_MS = 24 * 60 * 60 * 1000
const MAX_DURATION_SECONDS = 15

export const POST: APIRoute = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as
		| { code?: string; userId?: string; token?: string }
		| null
	const code = body?.code?.toUpperCase()
	if (!code) return new Response('Missing code', { status: 400 })

	if (!env.CF_STREAM_ACCOUNT_ID || !env.CF_STREAM_API_TOKEN) {
		return new Response('Cloudflare Stream is not configured', { status: 503 })
	}

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({
			id: schema.events.id,
			status: schema.events.status,
			tier: schema.events.tier,
			eventDate: schema.events.eventDate,
		})
		.from(schema.events)
		.where(eq(schema.events.shortCode, code))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })
	if (event.status !== 'live') return new Response('Event not live', { status: 403 })
	if (event.tier !== 'gold') return new Response('Video is only available on Gold events', { status: 403 })

	const user = await verifyGuest(db, event.id, body?.userId, body?.token)
	if (!user) return new Response('Unauthorized', { status: 401 })

	const opensAt = event.eventDate.getTime() - UPLOAD_OPENS_BEFORE_EVENT_MS
	if (Date.now() < opensAt) {
		return Response.json(
			{
				error: 'not_open_yet',
				message: 'Uploads open 24 hours before the event.',
				opensAt: new Date(opensAt).toISOString(),
			},
			{ status: 403 }
		)
	}

	const tier = isTier(event.tier) ? event.tier : 'free'
	const photoCap = TIERS[tier].photoCap
	const count = await countActiveMedia(db, event.id)

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

	const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString()
	const r = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${env.CF_STREAM_ACCOUNT_ID}/stream/direct_upload`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				maxDurationSeconds: MAX_DURATION_SECONDS,
				expiry,
				creator: user.id,
				meta: {
					eventId: event.id,
					eventCode: code,
					eventUserId: user.id,
				},
			}),
		}
	)

	if (!r.ok) {
		const txt = await r.text()
		console.error('CF Stream direct_upload failed', r.status, txt)
		return new Response('Video upload init failed', { status: 502 })
	}

	const data = (await r.json()) as {
		result?: { uid?: string; uploadURL?: string }
		success?: boolean
	}
	if (!data.result?.uid || !data.result.uploadURL) {
		console.error('CF Stream direct_upload malformed response', data)
		return new Response('Video upload init failed', { status: 502 })
	}

	return Response.json({
		uid: data.result.uid,
		uploadURL: data.result.uploadURL,
		maxDurationSeconds: MAX_DURATION_SECONDS,
	})
}
