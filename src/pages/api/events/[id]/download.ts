import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { and, eq, ne, asc } from 'drizzle-orm'
import { downloadZip } from 'client-zip'
import * as schema from '../../../../db/schema'
import { verifyEventDownload } from '../../../../lib/event-download'

export const prerender = false

const SAFE_NAME = /[^a-z0-9_\- ]+/gi

function safeFilename(name: string): string {
	const cleaned = name.replace(SAFE_NAME, '').trim().replace(/\s+/g, '-')
	return cleaned.slice(0, 60) || 'event'
}

export const GET: APIRoute = async ({ params, locals, url }) => {
	const id = params.id
	if (!id) return new Response('Missing event id', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({
			id: schema.events.id,
			name: schema.events.name,
			hostId: schema.events.hostId,
			eventDate: schema.events.eventDate,
		})
		.from(schema.events)
		.where(eq(schema.events.id, id))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })

	const key = url.searchParams.get('key')
	const isHost = !!locals.host && locals.host.id === event.hostId
	const validKey = await verifyEventDownload(event.id, key, env.BETTER_AUTH_SECRET)
	if (!isHost && !validKey) return new Response('Unauthorized', { status: 401 })

	const photos = await db
		.select({
			id: schema.photos.id,
			cfImagesId: schema.photos.cfImagesId,
			cfStreamUid: schema.photos.cfStreamUid,
			mediaType: schema.photos.mediaType,
			createdAt: schema.photos.createdAt,
		})
		.from(schema.photos)
		.where(and(eq(schema.photos.eventId, event.id), ne(schema.photos.status, 'rejected')))
		.orderBy(asc(schema.photos.createdAt))

	const downloadable = photos.filter((p) => p.cfImagesId || p.cfStreamUid)
	if (downloadable.length === 0) {
		return new Response('Nothing to download', { status: 404 })
	}

	// Fetch each asset in parallel — photos from CF Images, videos as MP4
	// from CF Stream. Returns null for assets that aren't fetchable (e.g.
	// MP4 still processing on Stream — we skip those rather than block).
	const files = await Promise.all(
		downloadable.map(async (p, i) => {
			const seq = String(i + 1).padStart(4, '0')
			const ts = p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : ''
			const prefix = `${seq}${ts ? '-' + ts : ''}`

			if (p.mediaType === 'video' && p.cfStreamUid) {
				const r = await fetch(
					`https://${env.CF_STREAM_CUSTOMER_DOMAIN}/${p.cfStreamUid}/downloads/default.mp4`
				)
				if (!r.ok || !r.body) return null
				return {
					name: `${prefix}.mp4`,
					lastModified: p.createdAt ?? new Date(),
					input: r.body,
				}
			}

			if (p.cfImagesId) {
				const r = await fetch(
					`https://imagedelivery.net/${env.CF_IMAGES_HASH}/${p.cfImagesId}/download`
				)
				if (!r.ok || !r.body) return null
				const ext = (r.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg'
				return {
					name: `${prefix}.${ext}`,
					lastModified: p.createdAt ?? new Date(),
					input: r.body,
				}
			}

			return null
		})
	)

	const validFiles = files.filter((f): f is NonNullable<typeof f> => f !== null)
	if (validFiles.length === 0) {
		return new Response('Could not fetch any assets', { status: 502 })
	}

	const datePart = event.eventDate ? new Date(event.eventDate).toISOString().slice(0, 10) : ''
	const filename = `${safeFilename(event.name)}${datePart ? '-' + datePart : ''}.zip`

	const res = downloadZip(validFiles)
	const headers = new Headers(res.headers)
	headers.set('Content-Disposition', `attachment; filename="${filename}"`)
	headers.set('Cache-Control', 'private, no-store')
	return new Response(res.body, { status: 200, headers })
}
