import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '../../../db/schema'
import { TIERS, isTier } from '../../../lib/tiers'

export const prerender = false

// Unambiguous base32 alphabet (no I/O/0/1) for short codes.
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateShortCode(): string {
	const bytes = new Uint8Array(6)
	crypto.getRandomValues(bytes)
	return Array.from(bytes, (b) => SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length]).join('')
}

export const POST: APIRoute = async ({ request, locals, redirect }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const formData = await request.formData()
	const name = formData.get('name')?.toString().trim()
	const eventDateStr = formData.get('eventDate')?.toString()
	const tierInput = formData.get('tier')?.toString()
	const returnToPrefixInput = formData.get('returnToPrefix')?.toString()

	if (!name || !eventDateStr) {
		return new Response('Missing required fields', { status: 400 })
	}

	const eventDate = new Date(eventDateStr)
	if (isNaN(eventDate.getTime())) {
		return new Response('Invalid event date', { status: 400 })
	}

	const tier = isTier(tierInput) ? tierInput : 'free'
	const { retentionDays } = TIERS[tier]
	const returnToPrefix =
		returnToPrefixInput === '/en/app/events' || returnToPrefixInput === '/da/app/events'
			? returnToPrefixInput
			: '/app/events'
	const newRoutePrefix = returnToPrefix.replace(/\/events$/, '/events/new')

	const db = drizzle(env.DB, { schema })

	// Free tier: one event per host at a time. Existing free events must be
	// deleted (or naturally expire to 'ended') before creating another.
	if (tier === 'free') {
		const [existingFree] = await db
			.select({ id: schema.events.id })
			.from(schema.events)
			.where(
				and(
					eq(schema.events.hostId, host.id),
					eq(schema.events.tier, 'free'),
					inArray(schema.events.status, ['draft', 'live'])
				)
			)
			.limit(1)
		if (existingFree) {
			return redirect(`${newRoutePrefix}?error=free_exists`, 303)
		}
	}

	const id = crypto.randomUUID()
	// Free events go straight to `live` since there's no payment gate. Upload
	// timing is still enforced server-side (24h before event_date). Paid
	// events stay `draft` until Stripe completes — `activateEventFromPaid…`
	// flips them to `live` after payment.
	const status: 'live' | 'draft' = tier === 'free' ? 'live' : 'draft'
	await db.insert(schema.events).values({
		id,
		hostId: host.id,
		name,
		eventDate,
		shortCode: generateShortCode(),
		tier,
		retentionDays,
		status,
	})

	return redirect(`${returnToPrefix}/${id}`, 303)
}
