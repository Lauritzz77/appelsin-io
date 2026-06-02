import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq, and } from 'drizzle-orm'
import * as schema from '../../../db/schema'
import { deletePhotoAssets } from '../../../lib/cleanup'
import type { NewPhotoMessage, DeletePhotoMessage } from '../../../worker-entry'

export const prerender = false

// Host approves or rejects a queued (pending) photo. On approve we broadcast it
// to the wall just like a fresh upload; on reject we tell displays to drop it.
export const PATCH: APIRoute = async ({ params, request, locals }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const photoId = params.id
	if (!photoId) return new Response('Missing photo id', { status: 400 })

	const body = (await request.json().catch(() => null)) as { status?: unknown } | null
	const nextStatus = body?.status
	if (nextStatus !== 'approved' && nextStatus !== 'rejected') {
		return new Response('status must be approved or rejected', { status: 400 })
	}

	const db = drizzle(env.DB, { schema })

	// Join through events to enforce host ownership; left-join the uploader so an
	// approved photo carries its name overlay onto the wall.
	const [row] = await db
		.select({
			id: schema.photos.id,
			eventId: schema.photos.eventId,
			mediaType: schema.photos.mediaType,
			cfImagesId: schema.photos.cfImagesId,
			cfStreamUid: schema.photos.cfStreamUid,
			durationSeconds: schema.photos.durationSeconds,
			mediaWidth: schema.photos.mediaWidth,
			mediaHeight: schema.photos.mediaHeight,
			createdAt: schema.photos.createdAt,
			uploaderName: schema.eventUsers.name,
		})
		.from(schema.photos)
		.innerJoin(schema.events, eq(schema.events.id, schema.photos.eventId))
		.leftJoin(schema.eventUsers, eq(schema.eventUsers.id, schema.photos.eventUserId))
		.where(and(eq(schema.photos.id, photoId), eq(schema.events.hostId, host.id)))
		.limit(1)

	if (!row) return new Response('Photo not found', { status: 404 })

	await db.update(schema.photos).set({ status: nextStatus }).where(eq(schema.photos.id, row.id))

	const stubId = env.EVENT_CHANNEL.idFromName(row.eventId)
	const stub = env.EVENT_CHANNEL.get(stubId)
	const message: NewPhotoMessage | DeletePhotoMessage =
		nextStatus === 'approved'
			? {
					type: 'new-photo',
					photoId: row.id,
					mediaType: row.mediaType,
					cfImagesId: row.cfImagesId,
					cfStreamUid: row.cfStreamUid,
					durationSeconds: row.durationSeconds,
					createdAt: row.createdAt?.getTime() ?? Date.now(),
					uploaderName: row.uploaderName ?? null,
					mediaWidth: row.mediaWidth ?? null,
					mediaHeight: row.mediaHeight ?? null,
				}
			: { type: 'delete-photo', photoId: row.id }
	await stub.fetch(
		new Request('https://do.local/notify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(message),
		})
	)

	return Response.json({ ok: true, status: nextStatus })
}

export const DELETE: APIRoute = async ({ params, locals }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const photoId = params.id
	if (!photoId) return new Response('Missing photo id', { status: 400 })

	const db = drizzle(env.DB, { schema })

	// Join through events to enforce host ownership in a single query.
	const [row] = await db
		.select({
			id: schema.photos.id,
			cfImagesId: schema.photos.cfImagesId,
			cfStreamUid: schema.photos.cfStreamUid,
			r2OriginalKey: schema.photos.r2OriginalKey,
		})
		.from(schema.photos)
		.innerJoin(schema.events, eq(schema.events.id, schema.photos.eventId))
		.where(and(eq(schema.photos.id, photoId), eq(schema.events.hostId, host.id)))
		.limit(1)

	if (!row) return new Response('Photo not found', { status: 404 })

	const errs = await deletePhotoAssets(env, {
		cfImagesId: row.cfImagesId,
		cfStreamUid: row.cfStreamUid,
		r2OriginalKey: row.r2OriginalKey,
	})
	await db.delete(schema.photos).where(eq(schema.photos.id, row.id))

	return Response.json({ ok: true, assetErrors: errs })
}
