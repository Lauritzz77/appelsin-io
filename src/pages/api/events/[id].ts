import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { and, eq } from 'drizzle-orm'
import * as schema from '../../../db/schema'
import { deletePhotoAssets } from '../../../lib/cleanup'

export const prerender = false

const MAX_EVENT_NAME_LENGTH = 80

function normaliseEventName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null
	const cleaned = raw
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
	if (!cleaned) return null
	if (cleaned.length > MAX_EVENT_NAME_LENGTH) return cleaned.slice(0, MAX_EVENT_NAME_LENGTH)
	return cleaned
}

export const PATCH: APIRoute = async ({ request, params, locals }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const id = params.id
	if (!id) return new Response('Missing event id', { status: 400 })

	const body = (await request.json().catch(() => null)) as
		| { name?: unknown; eventDate?: unknown; hasBigScreen?: unknown; moderationMode?: unknown }
		| null

	const updates: {
		name?: string
		eventDate?: Date
		hasBigScreen?: boolean
		moderationMode?: 'open' | 'queue'
	} = {}
	if (body && 'name' in body) {
		const name = normaliseEventName(body.name)
		if (!name) return new Response('Missing event name', { status: 400 })
		updates.name = name
	}
	if (body && 'eventDate' in body) {
		if (typeof body.eventDate !== 'string') return new Response('Invalid event date', { status: 400 })
		const eventDate = new Date(body.eventDate)
		if (isNaN(eventDate.getTime())) return new Response('Invalid event date', { status: 400 })
		updates.eventDate = eventDate
	}
	if (body && 'hasBigScreen' in body) {
		if (typeof body.hasBigScreen !== 'boolean') {
			return new Response('hasBigScreen must be boolean', { status: 400 })
		}
		updates.hasBigScreen = body.hasBigScreen
	}
	if (body && 'moderationMode' in body) {
		if (body.moderationMode !== 'open' && body.moderationMode !== 'queue') {
			return new Response('moderationMode must be open or queue', { status: 400 })
		}
		updates.moderationMode = body.moderationMode
	}
	if (Object.keys(updates).length === 0) {
		return new Response('No fields to update', { status: 400 })
	}

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({ id: schema.events.id, status: schema.events.status })
		.from(schema.events)
		.where(and(eq(schema.events.id, id), eq(schema.events.hostId, host.id)))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })
	if (updates.eventDate && event.status === 'live') {
		return new Response('Event date cannot be changed while the event is live', { status: 409 })
	}

	await db.update(schema.events).set(updates).where(eq(schema.events.id, event.id))

	return Response.json({ ok: true, ...updates })
}

export const DELETE: APIRoute = async ({ params, locals }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const id = params.id
	if (!id) return new Response('Missing event id', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({ id: schema.events.id })
		.from(schema.events)
		.where(and(eq(schema.events.id, id), eq(schema.events.hostId, host.id)))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })

	const photos = await db
		.select({
			id: schema.photos.id,
			cfImagesId: schema.photos.cfImagesId,
			cfStreamUid: schema.photos.cfStreamUid,
			r2OriginalKey: schema.photos.r2OriginalKey,
		})
		.from(schema.photos)
		.where(eq(schema.photos.eventId, event.id))

	let assetErrors = 0
	for (const photo of photos) {
		assetErrors += await deletePhotoAssets(env, photo)
	}

	// Paid-event bookkeeping survives event deletion; see schema comment.
	await db
		.update(schema.eventPurchases)
		.set({ eventId: null })
		.where(eq(schema.eventPurchases.eventId, event.id))

	await db.delete(schema.events).where(eq(schema.events.id, event.id))

	return Response.json({ ok: true, photosDeleted: photos.length, assetErrors })
}
