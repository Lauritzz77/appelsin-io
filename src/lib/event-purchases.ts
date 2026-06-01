import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import * as schema from '../db/schema'
import { isTier } from './tiers'

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

	await db
		.update(schema.events)
		.set({ status: 'live' })
		.where(eq(schema.events.id, eventId))

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
