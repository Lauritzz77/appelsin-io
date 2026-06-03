import { drizzle } from 'drizzle-orm/d1'
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import * as schema from '../db/schema'
import { signEventDownload, verifyEventDownload } from './event-download'

export type EventMediaAccess = 'host' | 'signed_key'

export type EventMediaAccessResult =
	| {
			ok: true
			access: EventMediaAccess
			accessKey: string
	  }
	| { ok: false; reason: 'unauthorized' }

export type EventGalleryMedia = {
	id: string
	cfImagesId: string | null
	cfStreamUid: string | null
	mediaType: 'photo' | 'video'
	durationSeconds: number | null
	createdAt: Date
}

type Db = ReturnType<typeof drizzle<typeof schema>>

export async function resolveEventMediaAccess(params: {
	eventId: string
	eventHostId: string
	hostId?: string | null
	key?: string | null
	secret: string
}): Promise<EventMediaAccessResult> {
	const validKey = await verifyEventDownload(params.eventId, params.key, params.secret)
	if (params.hostId === params.eventHostId) {
		return {
			ok: true,
			access: 'host',
			accessKey: validKey && params.key
				? params.key
				: await signEventDownload(params.eventId, params.secret),
		}
	}
	if (validKey && params.key) {
		return { ok: true, access: 'signed_key', accessKey: params.key }
	}
	return { ok: false, reason: 'unauthorized' }
}

export function parseRequestedMediaIds(value: string | null): string[] | null {
	if (!value) return null
	const ids = value
		.split(',')
		.map((id) => id.trim())
		.filter((id) => /^[a-z0-9-]{20,}$/i.test(id))
	return ids.length > 0 ? ids : null
}

export async function listEventMediaForAccess(
	db: Db,
	params: {
		eventId: string
		access: EventMediaAccess
		order?: 'newest' | 'oldest'
		ids?: string[] | null
	}
): Promise<EventGalleryMedia[]> {
	const filters = [
		eq(schema.photos.eventId, params.eventId),
		params.access === 'host'
			? ne(schema.photos.status, 'rejected')
			: eq(schema.photos.status, 'approved'),
	]
	if (params.ids?.length) filters.push(inArray(schema.photos.id, params.ids))

	return await db
		.select({
			id: schema.photos.id,
			cfImagesId: schema.photos.cfImagesId,
			cfStreamUid: schema.photos.cfStreamUid,
			mediaType: schema.photos.mediaType,
			durationSeconds: schema.photos.durationSeconds,
			createdAt: schema.photos.createdAt,
		})
		.from(schema.photos)
		.where(and(...filters))
		.orderBy(
			params.order === 'oldest'
				? asc(schema.photos.createdAt)
				: desc(schema.photos.createdAt)
		)
}

export async function findEventPhotoForAccess(
	db: Db,
	params: {
		eventId: string
		photoId: string
		access: EventMediaAccess
	}
): Promise<Pick<EventGalleryMedia, 'id' | 'cfImagesId' | 'mediaType' | 'createdAt'> | null> {
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
				eq(schema.photos.id, params.photoId),
				eq(schema.photos.eventId, params.eventId),
				params.access === 'host'
					? ne(schema.photos.status, 'rejected')
					: eq(schema.photos.status, 'approved')
			)
		)
		.limit(1)

	return photo ?? null
}
