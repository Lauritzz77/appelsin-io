import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../../db/schema'
import { createStripe } from '../../../lib/stripe'
import {
	SUBSCRIPTION_PLANS,
	getOrCreateStripeCustomer,
	getPriceId,
	isSubscriptionPlan,
} from '../../../lib/billing'

export const prerender = false

// Start a Pro subscription via Stripe Checkout. POST with form-encoded
// `plan=pro_monthly` or `plan=pro_yearly`. The webhook is the source of
// truth for the resulting `subscriptions` row + `hosts.plan` flip.
export const POST: APIRoute = async ({ request, locals, redirect }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const form = await request.formData()
	const planId = form.get('plan')
	if (!isSubscriptionPlan(planId)) {
		return new Response('Invalid plan', { status: 400 })
	}
	const plan = SUBSCRIPTION_PLANS[planId]

	const stripe = createStripe(env)
	const db = drizzle(env.DB, { schema })
	const customerId = await getOrCreateStripeCustomer(stripe, db, host)

	const session = await stripe.checkout.sessions.create({
		mode: 'subscription',
		customer: customerId,
		line_items: [{ price: getPriceId(env, planId), quantity: 1 }],
		// metadata on the subscription is what the webhook reads to attribute
		// the sub back to a host and decide tier — session.metadata wouldn't
		// reach the later customer.subscription.* events.
		subscription_data: {
			metadata: { hostId: host.id, tier: plan.tier },
		},
		success_url: `${env.PUBLIC_APP_URL}/app/billing?subscribed=1`,
		cancel_url: `${env.PUBLIC_APP_URL}/app/billing`,
	})

	if (!session.url) {
		return new Response('Stripe did not return a checkout URL', { status: 502 })
	}

	return redirect(session.url, 303)
}
