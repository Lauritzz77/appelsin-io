import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import type Stripe from 'stripe'
import * as schema from '../../../db/schema'
import { createStripe } from '../../../lib/stripe'
import { syncSubscriptionFromStripe } from '../../../lib/billing'
import { activateEventFromPaidCheckoutSession } from '../../../lib/event-purchases'

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
			await activateEventFromPaidCheckoutSession(db, session)
			break
		}

		case 'customer.subscription.created':
		case 'customer.subscription.updated':
		case 'customer.subscription.deleted': {
			// Re-retrieve the authoritative subscription rather than trusting the
			// webhook payload. Stripe doesn't guarantee delivery order, so a stale
			// `updated(active)` arriving after `deleted(canceled)` would otherwise
			// resurrect a cancelled plan (syncSubscriptionFromStripe is last-writer-wins).
			const sub = await stripe.subscriptions.retrieve(event.data.object.id)
			await syncSubscriptionFromStripe(db, sub)
			break
		}

		default:
			// Other event types (invoice.*, payment_intent.*, etc.) are not
			// load-bearing yet — Stripe still gets a 200 so it stops retrying.
			break
	}

	return new Response('ok', { status: 200 })
}
