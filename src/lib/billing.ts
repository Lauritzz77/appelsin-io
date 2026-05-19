import type Stripe from 'stripe'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'

// Subscription plans (separate from one-off event tiers in `./tiers.ts`).
// A subscription is the host-level "Pro" entitlement — unlimited events,
// future white-label, future team seats. Price IDs come from Stripe
// (Dashboard → Products → "Pro" → add a recurring Price for monthly + yearly)
// and are stored as env vars so the same code targets test + live modes.
export const SUBSCRIPTION_PLANS = {
	pro_monthly: {
		label: 'Pro monthly',
		tier: 'pro',
		priceCents: 3900,
		currency: 'eur',
		interval: 'month',
		envVar: 'STRIPE_PRICE_PRO_MONTHLY',
	},
	pro_yearly: {
		label: 'Pro yearly',
		tier: 'pro',
		priceCents: 39000,
		currency: 'eur',
		interval: 'year',
		envVar: 'STRIPE_PRICE_PRO_YEARLY',
	},
} as const satisfies Record<string, SubscriptionPlanDef>

type SubscriptionPlanDef = {
	label: string
	tier: 'pro'
	priceCents: number
	currency: string
	interval: 'month' | 'year'
	envVar: 'STRIPE_PRICE_PRO_MONTHLY' | 'STRIPE_PRICE_PRO_YEARLY'
}

export type SubscriptionPlanId = keyof typeof SUBSCRIPTION_PLANS
export const SUBSCRIPTION_PLAN_IDS = Object.keys(SUBSCRIPTION_PLANS) as SubscriptionPlanId[]

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlanId {
	return typeof value === 'string' && value in SUBSCRIPTION_PLANS
}

export function getPriceId(env: Cloudflare.Env, planId: SubscriptionPlanId): string {
	const plan = SUBSCRIPTION_PLANS[planId]
	const id = env[plan.envVar]
	if (!id) throw new Error(`Missing Stripe price id env var: ${plan.envVar}`)
	return id
}

// Get the host's Stripe customer id, creating one (and persisting it) if
// missing. Reusing a single customer per host keeps the Customer Portal,
// invoice history, and saved payment methods consistent across one-off
// purchases and the subscription.
export async function getOrCreateStripeCustomer(
	stripe: Stripe,
	db: ReturnType<typeof drizzle<typeof schema>>,
	host: { id: string; email: string }
): Promise<string> {
	const [row] = await db
		.select({ stripeCustomerId: schema.hosts.stripeCustomerId })
		.from(schema.hosts)
		.where(eq(schema.hosts.id, host.id))
		.limit(1)

	if (row?.stripeCustomerId) return row.stripeCustomerId

	const customer = await stripe.customers.create({
		email: host.email,
		metadata: { hostId: host.id },
	})

	await db
		.update(schema.hosts)
		.set({ stripeCustomerId: customer.id, updatedAt: new Date() })
		.where(eq(schema.hosts.id, host.id))

	return customer.id
}

// Mirror a Stripe subscription into our `subscriptions` table and update
// the host's `plan` field. Called from both `checkout.session.completed`
// (first sign-up) and `customer.subscription.{updated,deleted}` so the two
// stores never drift.
export async function syncSubscriptionFromStripe(
	db: ReturnType<typeof drizzle<typeof schema>>,
	sub: Stripe.Subscription
): Promise<void> {
	const hostId = sub.metadata?.hostId
	const tier = sub.metadata?.tier ?? 'pro'
	if (!hostId) return

	const isEntitled = sub.status === 'active' || sub.status === 'trialing'
	// As of Stripe API 2024-12 the period boundaries moved off the subscription
	// and onto each subscription item. For our single-item Pro subscriptions
	// every item shares the same period, so item[0] is authoritative.
	const periodEndUnix = sub.items.data[0]?.current_period_end ?? null
	const currentPeriodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null

	await db
		.insert(schema.subscriptions)
		.values({
			hostId,
			stripeSubId: sub.id,
			tier,
			status: sub.status,
			cancelAtPeriodEnd: sub.cancel_at_period_end,
			currentPeriodEnd,
		})
		.onConflictDoUpdate({
			target: schema.subscriptions.hostId,
			set: {
				stripeSubId: sub.id,
				tier,
				status: sub.status,
				cancelAtPeriodEnd: sub.cancel_at_period_end,
				currentPeriodEnd,
			},
		})

	await db
		.update(schema.hosts)
		.set({ plan: isEntitled ? tier : 'free', updatedAt: new Date() })
		.where(eq(schema.hosts.id, hostId))
}
