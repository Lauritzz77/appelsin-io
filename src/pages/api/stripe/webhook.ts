import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import * as schema from '../../../db/schema'
import { createStripe } from '../../../lib/stripe'
import { isTier } from '../../../lib/tiers'
import { syncSubscriptionFromStripe } from '../../../lib/billing'

export const prerender = false

export const POST: APIRoute = async ({ request }) => {
	const stripe = createStripe(env)

	const signature = request.headers.get('stripe-signature')
	if (!signature) return new Response('Missing stripe-signature', { status: 400 })

	const body = await request.text()
	let event: Stripe.Event
	try {
		event = await stripe.webhooks.constructEventAsync(
			body,
			signature,
			env.STRIPE_WEBHOOK_SECRET
		)
	} catch (e) {
		return new Response(`Signature verification failed: ${(e as Error).message}`, {
			status: 400,
		})
	}

	const db = drizzle(env.DB, { schema })

	switch (event.type) {
		case 'checkout.session.completed': {
			const session = event.data.object
			if (session.mode === 'subscription') {
				// Subscription Checkout completed — fetch the full subscription
				// and mirror it. The customer.subscription.* events will keep it
				// in sync from here on.
				const subId = typeof session.subscription === 'string'
					? session.subscription
					: session.subscription?.id
				if (subId) {
					const sub = await stripe.subscriptions.retrieve(subId)
					await syncSubscriptionFromStripe(db, sub)
				}
				break
			}

			// One-off event pass (payment mode).
			const eventId = session.metadata?.eventId
			const hostId = session.metadata?.hostId
			const tier = session.metadata?.tier
			if (eventId && hostId && isTier(tier)) {
				await db
					.update(schema.events)
					.set({ status: 'live' })
					.where(eq(schema.events.id, eventId))
				// onConflictDoNothing on the unique stripe_session_id index makes
				// this safe under Stripe's at-least-once retries.
				await db
					.insert(schema.eventPurchases)
					.values({
						hostId,
						eventId,
						stripeSessionId: session.id,
						tier,
					})
					.onConflictDoNothing()
			}
			break
		}

		case 'customer.subscription.created':
		case 'customer.subscription.updated':
		case 'customer.subscription.deleted': {
			await syncSubscriptionFromStripe(db, event.data.object)
			break
		}

		default:
			// Other event types (invoice.*, payment_intent.*, etc.) are not
			// load-bearing yet — Stripe still gets a 200 so it stops retrying.
			break
	}

	return new Response('ok', { status: 200 })
}
