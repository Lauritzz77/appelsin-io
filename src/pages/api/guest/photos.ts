import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { and, desc, eq, ne } from 'drizzle-orm'
import * as schema from '../../../db/schema'
import { deletePhotoAssets } from '../../../lib/cleanup'
import { verifyGuest } from '../../../lib/guest-auth'
import { notifyEventChannel } from '../../../lib/event-media'
import type { DeletePhotoMessage } from '../../../worker-entry'

export const prerender = false

const MAX_PHOTOS = 60

// Returns the photos this guest has uploaded to the event, newest first.
// Authenticated by the opaque `{ userId, token }` pair stored client-side
// after the guest joined.
//
// POST (not GET) so the token travels in the request body, not the URL —
// keeps it out of access logs and out of the browser history.
export const POST: APIRoute = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as
		| { code?: string; userId?: string; token?: string }
		| null
	const code = body?.code?.toUpperCase()
	if (!code) return new Response('Missing code', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({ id: schema.events.id })
		.from(schema.events)
		.where(eq(schema.events.shortCode, code))
		.limit(1)
	if (!event) return new Response('Event not found', { status: 404 })

	const user = await verifyGuest(db, event.id, body?.userId, body?.token)
	if (!user) return new Response('Unauthorized', { status: 401 })

	const rows = await db
		.select({
			id: schema.photos.id,
			cfImagesId: schema.photos.cfImagesId,
			cfStreamUid: schema.photos.cfStreamUid,
			mediaType: schema.photos.mediaType,
			durationSeconds: schema.photos.durationSeconds,
			createdAt: schema.photos.createdAt,
		})
		.from(schema.photos)
		.where(
			and(
				eq(schema.photos.eventUserId, user.id),
				ne(schema.photos.status, 'rejected')
			)
		)
		.orderBy(desc(schema.photos.createdAt))
		.limit(MAX_PHOTOS)

	return Response.json({
		name: user.name,
		photos: rows.map((r) => ({
			id: r.id,
			mediaType: r.mediaType,
			cfImagesId: r.cfImagesId,
			cfStreamUid: r.cfStreamUid,
			durationSeconds: r.durationSeconds,
			createdAt: r.createdAt?.getTime() ?? 0,
		})),
	})
}

export const DELETE: APIRoute = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as
		| { code?: string; userId?: string; token?: string; photoId?: string }
		| null
	const code = body?.code?.toUpperCase()
	if (!code) return new Response('Missing code', { status: 400 })
	if (!body?.photoId) return new Response('Missing photoId', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({ id: schema.events.id })
		.from(schema.events)
		.where(eq(schema.events.shortCode, code))
		.limit(1)
	if (!event) return new Response('Event not found', { status: 404 })

	const user = await verifyGuest(db, event.id, body.userId, body.token)
	if (!user) return new Response('Unauthorized', { status: 401 })

	const [photo] = await db
		.select({
			id: schema.photos.id,
			cfImagesId: schema.photos.cfImagesId,
			cfStreamUid: schema.photos.cfStreamUid,
			r2OriginalKey: schema.photos.r2OriginalKey,
		})
		.from(schema.photos)
		.where(
			and(
				eq(schema.photos.id, body.photoId),
				eq(schema.photos.eventId, event.id),
				eq(schema.photos.eventUserId, user.id)
			)
		)
		.limit(1)

	if (!photo) return new Response('Photo not found', { status: 404 })

	const errs = await deletePhotoAssets(env, {
		cfImagesId: photo.cfImagesId,
		cfStreamUid: photo.cfStreamUid,
		r2OriginalKey: photo.r2OriginalKey,
	})
	await db.delete(schema.photos).where(eq(schema.photos.id, photo.id))

	const payload: DeletePhotoMessage = { type: 'delete-photo', photoId: photo.id }
	await notifyEventChannel(env, event.id, payload)

	return Response.json({ ok: true, assetErrors: errs })
}
