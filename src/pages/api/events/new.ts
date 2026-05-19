import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
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

	if (!name || !eventDateStr) {
		return new Response('Missing required fields', { status: 400 })
	}

	const eventDate = new Date(eventDateStr)
	if (isNaN(eventDate.getTime())) {
		return new Response('Invalid event date', { status: 400 })
	}

	const tier = isTier(tierInput) ? tierInput : 'free'
	const { retentionDays } = TIERS[tier]

	const db = drizzle(env.DB, { schema })
	const id = crypto.randomUUID()
	await db.insert(schema.events).values({
		id,
		hostId: host.id,
		name,
		eventDate,
		shortCode: generateShortCode(),
		tier,
		retentionDays,
	})

	return redirect(`/app/events/${id}`, 303)
}
