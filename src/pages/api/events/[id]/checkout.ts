import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq, and } from 'drizzle-orm'
import * as schema from '../../../../db/schema'
import { createStripe } from '../../../../lib/stripe'
import { TIERS, isTier } from '../../../../lib/tiers'
import { getOrCreateStripeCustomer } from '../../../../lib/billing'

export const prerender = false

export const POST: APIRoute = async ({ params, locals, redirect }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const id = params.id
	if (!id) return new Response('Missing event id', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select()
		.from(schema.events)
		.where(and(eq(schema.events.id, id), eq(schema.events.hostId, host.id)))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })
	if (event.status !== 'draft') {
		return new Response(`Event already ${event.status}`, { status: 409 })
	}
	if (!isTier(event.tier)) {
		return new Response('Invalid tier', { status: 400 })
	}

	const tierConfig = TIERS[event.tier]
	if (tierConfig.priceCents <= 0) {
		return new Response('Free tier does not require checkout', { status: 400 })
	}

	const stripe = createStripe(env)
	const customerId = await getOrCreateStripeCustomer(stripe, db, host)
	const session = await stripe.checkout.sessions.create({
		mode: 'payment',
		customer: customerId,
		line_items: [
			{
				price_data: {
					currency: tierConfig.currency,
					product_data: {
						name: `${tierConfig.label} event — ${event.name}`,
						description: `Up to ${tierConfig.photoCap.toLocaleString('en-IE')} photos, ${tierConfig.retentionDays}-day retention.`,
					},
					unit_amount: tierConfig.priceCents,
				},
				quantity: 1,
			},
		],
		metadata: {
			eventId: event.id,
			hostId: host.id,
			tier: event.tier,
		},
		success_url: `${env.PUBLIC_APP_URL}/app/events/${event.id}?paid=1`,
		cancel_url: `${env.PUBLIC_APP_URL}/app/events/${event.id}`,
	})

	if (!session.url) {
		return new Response('Stripe did not return a checkout URL', { status: 502 })
	}

	return redirect(session.url, 303)
}
