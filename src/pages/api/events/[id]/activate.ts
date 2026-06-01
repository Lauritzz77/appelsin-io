import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, ne } from 'drizzle-orm'
import * as schema from '../../../../db/schema'
import { TIERS, isTier } from '../../../../lib/tiers'

export const prerender = false

// Flip a free-tier event from draft → live. Paid tiers must go through
// /api/events/[id]/checkout — their status is flipped by the Stripe webhook.
export const POST: APIRoute = async ({ params, locals, redirect }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const id = params.id
	if (!id) return new Response('Missing event id', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({
			id: schema.events.id,
			status: schema.events.status,
			tier: schema.events.tier,
		})
		.from(schema.events)
		.where(and(eq(schema.events.id, id), eq(schema.events.hostId, host.id)))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })
	if (event.status !== 'draft') {
		return new Response(`Event already ${event.status}`, { status: 409 })
	}
	if (!isTier(event.tier) || TIERS[event.tier].priceCents > 0) {
		return new Response('Paid tier — use checkout instead', { status: 402 })
	}

	// Free tier: only one live event per host at a time.
	const [otherLiveFree] = await db
		.select({ id: schema.events.id })
		.from(schema.events)
		.where(
			and(
				eq(schema.events.hostId, host.id),
				eq(schema.events.tier, 'free'),
				eq(schema.events.status, 'live'),
				ne(schema.events.id, event.id)
			)
		)
		.limit(1)
	if (otherLiveFree) {
		return redirect(`/app/events/${event.id}?activate_error=free_limit`, 303)
	}

	await db.update(schema.events).set({ status: 'live' }).where(eq(schema.events.id, event.id))

	return redirect(`/app/events/${event.id}`, 303)
}
