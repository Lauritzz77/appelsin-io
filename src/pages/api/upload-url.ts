import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq, ne, and, sql } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { TIERS, isTier } from '../../lib/tiers'

export const prerender = false

// Uploads open this long before `events.event_date`. Catches guests who scan
// the QR pack at home days before the wedding.
const UPLOAD_OPENS_BEFORE_EVENT_MS = 24 * 60 * 60 * 1000

// Mints a one-time direct-creator upload URL for Cloudflare Images, scoped to
// a specific event by short_code. Guests use this to upload directly to CF
// Images without their bytes touching our Worker.
export const POST: APIRoute = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { code?: string } | null
	const code = body?.code?.toUpperCase()
	if (!code) return new Response('Missing code', { status: 400 })

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

	// Soft cap: race conditions can cause small overshoot under simultaneous
	// uploads. Acceptable for an MVP; tighten with a DO if it ever matters.
	const [{ count }] = await db
		.select({ count: sql<number>`count(*)` })
		.from(schema.photos)
		.where(and(eq(schema.photos.eventId, event.id), ne(schema.photos.status, 'rejected')))

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

	const form = new FormData()
	form.append('metadata', JSON.stringify({ eventId: event.id, eventCode: code }))
	form.append('requireSignedURLs', 'false')

	const r = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${env.CF_IMAGES_ACCOUNT_ID}/images/v2/direct_upload`,
		{
			method: 'POST',
			headers: { Authorization: `Bearer ${env.CF_IMAGES_API_TOKEN}` },
			body: form,
		}
	)

	if (!r.ok) {
		const txt = await r.text()
		console.error('CF Images direct_upload failed', r.status, txt)
		return new Response('Upload init failed', { status: 502 })
	}

	const data = (await r.json()) as {
		result: { id: string; uploadURL: string }
		success: boolean
	}
	return Response.json({ id: data.result.id, uploadURL: data.result.uploadURL })
}
