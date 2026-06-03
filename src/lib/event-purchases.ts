import { drizzle } from 'drizzle-orm/d1'
import { and, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import * as schema from '../db/schema'
import { isTier, TIERS } from './tiers'

export async function activateEventFromPaidCheckoutSession(
	db: ReturnType<typeof drizzle<typeof schema>>,
	session: Stripe.Checkout.Session,
	expected?: { eventId?: string; hostId?: string }
): Promise<boolean> {
	if (session.mode !== 'payment') return false
	if (session.payment_status !== 'paid') return false

	const eventId = session.metadata?.eventId
	const hostId = session.metadata?.hostId
	const tier = session.metadata?.tier
	if (!eventId || !hostId || !isTier(tier)) return false
	if (expected?.eventId && expected.eventId !== eventId) return false
	if (expected?.hostId && expected.hostId !== hostId) return false

	// Defense in depth: assert Stripe actually charged one of this tier's
	// configured prices. `tier` comes from session metadata we set at checkout;
	// verifying the amount stops a future promo / zero-amount path from silently
	// granting a paid tier.
	const priceOk = Object.values(TIERS[tier].prices).some(
		(p) => session.amount_total === p.priceCents && session.currency === p.currency
	)
	if (!priceOk) {
		console.warn('checkout amount/currency mismatch', {
			sessionId: session.id,
			tier,
			amountTotal: session.amount_total,
			currency: session.currency,
		})
		return false
	}

	// Only promote a draft → live. A replayed or late webhook is then a no-op
	// once the event is already live or has been ended by retention cleanup, so
	// it can't resurrect an ended event.
	await db
		.update(schema.events)
		.set({ status: 'live' })
		.where(and(eq(schema.events.id, eventId), eq(schema.events.status, 'draft')))

	await db
		.insert(schema.eventPurchases)
		.values({
			hostId,
			eventId,
			stripeSessionId: session.id,
			tier,
		})
		.onConflictDoNothing()

	return true
}
