import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import * as schema from '../../../db/schema'
import { createStripe } from '../../../lib/stripe'

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

	if (event.type === 'checkout.session.completed') {
		const session = event.data.object
		const eventId = session.metadata?.eventId
		if (eventId) {
			const db = drizzle(env.DB, { schema })
			await db
				.update(schema.events)
				.set({ status: 'live' })
				.where(eq(schema.events.id, eventId))
		}
	}

	return new Response('ok', { status: 200 })
}
