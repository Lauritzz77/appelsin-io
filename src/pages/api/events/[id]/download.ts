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

type DownloadablePhoto = {
	id: string
	cfImagesId: string | null
	cfStreamUid: string | null
	mediaType: 'photo' | 'video'
	createdAt: Date
}

type ZipFile = {
	name: string
	lastModified: Date
	input: ReadableStream<Uint8Array>
}

function zipPrefix(photo: DownloadablePhoto, index: number): string {
	const seq = String(index + 1).padStart(4, '0')
	const ts = photo.createdAt ? new Date(photo.createdAt).toISOString().slice(0, 10) : ''
	return `${seq}${ts ? '-' + ts : ''}`
}

function parseRequestedIds(value: string | null): Set<string> | null {
	if (!value) return null
	const ids = value
		.split(',')
		.map((id) => id.trim())
		.filter((id) => /^[a-z0-9-]{20,}$/i.test(id))
	return ids.length > 0 ? new Set(ids) : null
}

async function fetchZipFile(
	photo: DownloadablePhoto,
	index: number,
	env: Cloudflare.Env,
	signal: AbortSignal
): Promise<ZipFile | null> {
	const prefix = zipPrefix(photo, index)

	if (photo.mediaType === 'video' && photo.cfStreamUid) {
		const res = await fetch(
			`https://${env.CF_STREAM_CUSTOMER_DOMAIN}/${photo.cfStreamUid}/downloads/default.mp4`,
			{ signal }
		).catch(() => null)
		if (!res?.ok || !res.body) return null
		return {
			name: `${prefix}.mp4`,
			lastModified: photo.createdAt ?? new Date(),
			input: res.body,
		}
	}

	if (photo.cfImagesId) {
		const res = await fetch(
			`https://imagedelivery.net/${env.CF_IMAGES_HASH}/${photo.cfImagesId}/download`,
			{ signal }
		).catch(() => null)
		if (!res?.ok || !res.body) return null
		const contentType = res.headers.get('content-type') || ''
		const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
		return {
			name: `${prefix}.${ext}`,
			lastModified: photo.createdAt ?? new Date(),
			input: res.body,
		}
	}

	return null
}

export const GET: APIRoute = async ({ params, locals, url, request }) => {
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

	const requestedIds = parseRequestedIds(url.searchParams.get('ids'))
	const photos = await db
		.select({
			id: schema.photos.id,
			cfImagesId: schema.photos.cfImagesId,
			cfStreamUid: schema.photos.cfStreamUid,
			mediaType: schema.photos.mediaType,
			createdAt: schema.photos.createdAt,
		})
		.from(schema.photos)
		.where(
			and(
				eq(schema.photos.eventId, event.id),
				// Key holders (guests) only download approved media; the host gets
				// everything not explicitly rejected.
				isHost ? ne(schema.photos.status, 'rejected') : eq(schema.photos.status, 'approved')
			)
		)
		.orderBy(asc(schema.photos.createdAt))

	const selectedPhotos = requestedIds ? photos.filter((p) => requestedIds.has(p.id)) : photos
	const downloadable = selectedPhotos.filter((p) => p.cfImagesId || p.cfStreamUid)
	if (downloadable.length === 0) {
		return new Response('Nothing to download', { status: 404 })
	}

	let firstFile: ZipFile | null = null
	let nextIndex = 0
	while (!firstFile && nextIndex < downloadable.length) {
		firstFile = await fetchZipFile(downloadable[nextIndex], nextIndex, env, request.signal)
		nextIndex++
	}

	if (!firstFile) {
		return new Response('Could not fetch any assets', { status: 502 })
	}
	const first = firstFile

	async function* zipFiles(): AsyncGenerator<ZipFile> {
		yield first
		for (let i = nextIndex; i < downloadable.length; i++) {
			const file = await fetchZipFile(downloadable[i], i, env, request.signal)
			if (file) yield file
		}
	}

	const datePart = event.eventDate ? new Date(event.eventDate).toISOString().slice(0, 10) : ''
	const filename = `${safeFilename(event.name)}${datePart ? '-' + datePart : ''}.zip`

	const res = downloadZip(zipFiles())
	const headers = new Headers(res.headers)
	headers.set('Content-Disposition', `attachment; filename="${filename}"`)
	headers.set('Cache-Control', 'private, no-store')
	headers.set('X-Archive-Asset-Count', String(downloadable.length))
	return new Response(res.body, { status: 200, headers })
}
