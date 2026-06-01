import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq, and } from 'drizzle-orm'
import * as schema from '../../../../db/schema'
import { TIERS, isTier } from '../../../../lib/tiers'
import {
	parseBranding,
	isHexColor,
	isDensityId,
	isFontId,
	type EventBranding,
} from '../../../../lib/branding'

export const prerender = false

// Persist a paid-tier event's photo-wall branding. Body is the JSON shape
// of EventBranding; we validate every field and only write the normalised
// version so the column never holds untrusted data.
export const PUT: APIRoute = async ({ request, params, locals }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const id = params.id
	if (!id) return new Response('Missing event id', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({ id: schema.events.id, tier: schema.events.tier })
		.from(schema.events)
		.where(and(eq(schema.events.id, id), eq(schema.events.hostId, host.id)))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })

	const tier = isTier(event.tier) ? event.tier : 'free'
	if (TIERS[tier].priceCents <= 0) {
		return Response.json(
			{ error: 'upgrade_required', message: 'Custom styling is a Basic / Gold feature.' },
			{ status: 403 }
		)
	}

	const body = (await request.json().catch(() => null)) as Partial<EventBranding> & {
		titleOverlay?: Partial<EventBranding['titleOverlay']>
	} | null
	if (!body) return new Response('Invalid JSON', { status: 400 })

	if (!isHexColor(body.background)) return new Response('Invalid background color', { status: 400 })
	if (!isHexColor(body.text)) return new Response('Invalid text color', { status: 400 })
	if (!isDensityId(body.density)) return new Response('Invalid density', { status: 400 })
	if (!isFontId(body.font)) return new Response('Invalid font', { status: 400 })

	const normalised: EventBranding = {
		background: body.background,
		text: body.text,
		density: body.density,
		font: body.font,
		titleOverlay: {
			enabled: Boolean(body.titleOverlay?.enabled),
			line1: String(body.titleOverlay?.line1 ?? '').slice(0, 80),
			line2: String(body.titleOverlay?.line2 ?? '').slice(0, 80),
		},
	}

	await db
		.update(schema.events)
		.set({ brandingJson: JSON.stringify(normalised) })
		.where(eq(schema.events.id, event.id))

	return Response.json({ ok: true, branding: normalised })
}

// Convenience read — useful when the editor wants to bootstrap from current
// state. Same auth + ownership gate as PUT.
export const GET: APIRoute = async ({ params, locals }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const id = params.id
	if (!id) return new Response('Missing event id', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({ brandingJson: schema.events.brandingJson })
		.from(schema.events)
		.where(and(eq(schema.events.id, id), eq(schema.events.hostId, host.id)))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })
	return Response.json({ branding: parseBranding(event.brandingJson) })
}
