import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { and, eq } from 'drizzle-orm'
import * as schema from '../../../db/schema'
import { MAX_NAME_LENGTH, normaliseDisplayName, normaliseEmail } from '../../../lib/guest-auth'

export const prerender = false

// A guest claims a display name on an event. Names are per-event and case-
// insensitive (`Lau` and `lau` collide). On success the browser stores the
// returned `{ userId, token }` in localStorage and presents them on every
// subsequent guest call to authorise.
//
// Names are strictly unique: a second guest typing an already-taken name
// gets 409 and is asked to choose a different one. We deliberately do NOT
// return the existing user's token on conflict — that would let anyone who
// can guess a name impersonate that guest.
export const POST: APIRoute = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as
		| { code?: string; name?: string; email?: string }
		| null
	const code = body?.code?.toUpperCase()
	const name = normaliseDisplayName(body?.name)
	const email = normaliseEmail(body?.email)

	if (!code) return new Response('Missing code', { status: 400 })
	if (!name) {
		return Response.json(
			{
				error: 'invalid_name',
				message: 'Pick a name with at least one visible character.',
			},
			{ status: 400 }
		)
	}
	if (!email) {
		return Response.json(
			{
				error: 'invalid_email',
				message: 'Enter a valid email so we can send you the photos after the event.',
			},
			{ status: 400 }
		)
	}

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({ id: schema.events.id, status: schema.events.status })
		.from(schema.events)
		.where(eq(schema.events.shortCode, code))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })
	if (event.status !== 'live') return new Response('Event not live', { status: 403 })

	const nameLower = name.toLowerCase()

	const [taken] = await db
		.select({ id: schema.eventUsers.id })
		.from(schema.eventUsers)
		.where(
			and(
				eq(schema.eventUsers.eventId, event.id),
				eq(schema.eventUsers.nameLower, nameLower)
			)
		)
		.limit(1)

	if (taken) {
		return Response.json(
			{ error: 'name_taken', message: 'Someone else is already using that name. Try another.' },
			{ status: 409 }
		)
	}

	const userId = crypto.randomUUID()
	const token = crypto.randomUUID()
	try {
		await db.insert(schema.eventUsers).values({
			id: userId,
			eventId: event.id,
			name,
			nameLower,
			email,
			token,
		})
	} catch (e) {
		// Race: another browser inserted between our SELECT and INSERT and
		// tripped the (event_id, name_lower) unique index. Surface as the
		// same conflict the pre-check returns.
		const msg = e instanceof Error ? e.message : String(e)
		if (msg.includes('UNIQUE') || msg.includes('constraint')) {
			return Response.json(
				{ error: 'name_taken', message: 'Someone else just took that name. Try another.' },
				{ status: 409 }
			)
		}
		console.error('event_users insert failed', e)
		return new Response('Failed to claim name', { status: 500 })
	}

	return Response.json({ userId, token, name, maxLength: MAX_NAME_LENGTH })
}
