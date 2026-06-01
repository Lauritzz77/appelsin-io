import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq, and } from 'drizzle-orm'
import * as schema from '../../../db/schema'
import { deletePhotoAssets } from '../../../lib/cleanup'

export const prerender = false

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
