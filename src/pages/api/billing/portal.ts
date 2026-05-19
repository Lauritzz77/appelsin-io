import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as schema from '../../../db/schema'
import { createStripe } from '../../../lib/stripe'

export const prerender = false

// Open the Stripe Customer Portal so a host can update payment methods,
// download invoices, or cancel their subscription. POST so the redirect
// happens as a form submission (CSRF-friendly).
export const POST: APIRoute = async ({ locals, redirect }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const db = drizzle(env.DB, { schema })
	const [row] = await db
		.select({ stripeCustomerId: schema.hosts.stripeCustomerId })
		.from(schema.hosts)
		.where(eq(schema.hosts.id, host.id))
		.limit(1)

	if (!row?.stripeCustomerId) {
		// Nothing to manage yet — bounce back with a flag the page reads.
		return redirect('/app/billing?nocustomer=1', 303)
	}

	const stripe = createStripe(env)
	const session = await stripe.billingPortal.sessions.create({
		customer: row.stripeCustomerId,
		return_url: `${env.PUBLIC_APP_URL}/app/billing`,
	})

	return redirect(session.url, 303)
}
