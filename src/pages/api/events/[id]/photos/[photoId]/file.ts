import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { and, eq, ne } from 'drizzle-orm'
import * as schema from '../../../../../../db/schema'
import { verifyEventDownload } from '../../../../../../lib/event-download'

export const prerender = false

const SAFE_NAME = /[^a-z0-9_\- ]+/gi

function safeFilename(name: string): string {
	const cleaned = name.replace(SAFE_NAME, '').trim().replace(/\s+/g, '-')
	return cleaned.slice(0, 60) || 'appelsin-event'
}

export const GET: APIRoute = async ({ params, locals, url }) => {
	const eventId = params.id
	const photoId = params.photoId
	if (!eventId || !photoId) return new Response('Missing id', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({
			id: schema.events.id,
			name: schema.events.name,
			hostId: schema.events.hostId,
		})
		.from(schema.events)
		.where(eq(schema.events.id, eventId))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })

	const key = url.searchParams.get('key')
	const isHost = !!locals.host && locals.host.id === event.hostId
	const validKey = await verifyEventDownload(event.id, key, env.BETTER_AUTH_SECRET)
	if (!isHost && !validKey) return new Response('Unauthorized', { status: 401 })

	const [photo] = await db
		.select({
			id: schema.photos.id,
			cfImagesId: schema.photos.cfImagesId,
			mediaType: schema.photos.mediaType,
			createdAt: schema.photos.createdAt,
		})
		.from(schema.photos)
		.where(
			and(
				eq(schema.photos.id, photoId),
				eq(schema.photos.eventId, event.id),
				ne(schema.photos.status, 'rejected')
			)
		)
		.limit(1)

	if (!photo?.cfImagesId || photo.mediaType !== 'photo') {
		return new Response('Photo not found', { status: 404 })
	}

	const upstream = await fetch(
		`https://imagedelivery.net/${env.CF_IMAGES_HASH}/${photo.cfImagesId}/download`
	)
	if (!upstream.ok || !upstream.body) {
		return new Response('Could not fetch image', { status: 502 })
	}

	const contentType = upstream.headers.get('content-type') || 'image/jpeg'
	const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
	const datePart = photo.createdAt ? new Date(photo.createdAt).toISOString().slice(0, 10) : ''
	const filename = `${safeFilename(event.name)}${datePart ? '-' + datePart : ''}-${photo.id.slice(0, 8)}.${ext}`

	return new Response(upstream.body, {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': `inline; filename="${filename}"`,
			'Cache-Control': 'private, no-store',
		},
	})
}
