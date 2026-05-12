import Stripe from 'stripe'

export function createStripe(env: Cloudflare.Env) {
	return new Stripe(env.STRIPE_SECRET_KEY, {
		httpClient: Stripe.createFetchHttpClient(),
	})
}

export type StripeClient = ReturnType<typeof createStripe>
