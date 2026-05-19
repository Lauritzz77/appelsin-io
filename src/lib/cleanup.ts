import { drizzle } from 'drizzle-orm/d1'
import { eq, and, lt, sql } from 'drizzle-orm'
import * as schema from '../db/schema'

export type CleanupResult = {
	flipped: number // live → ended
	eventsDeleted: number
	photosDeleted: number
	errors: number
}

// Process at most this many expired events per tick — keeps the scheduled
// invocation under the Workers CPU/time budget. If there's a backlog the next
// tick picks up the rest.
const MAX_EVENTS_PER_TICK = 10

// Seconds an event stays `live` past its `eventDate` before we end it. Gives
// guests the night-of + morning-after window for late uploads.
const POST_EVENT_GRACE_SECONDS = 2 * 24 * 3600

export async function runRetentionCleanup(env: Cloudflare.Env): Promise<CleanupResult> {
	const db = drizzle(env.DB, { schema })
	const result: CleanupResult = { flipped: 0, eventsDeleted: 0, photosDeleted: 0, errors: 0 }

	// 1. Flip live → ended for events past their grace window. expires_at is
	//    computed per-row from retention_days. Single UPDATE on the events table.
	const cutoffSeconds = Math.floor(Date.now() / 1000) - POST_EVENT_GRACE_SECONDS
	const flipRes = await env.DB.prepare(
		`UPDATE events
		 SET status = 'ended',
		     expires_at = unixepoch() + retention_days * 86400
		 WHERE status = 'live' AND event_date < ?`
	)
		.bind(cutoffSeconds)
		.run()
	result.flipped = flipRes.meta.changes ?? 0

	// 2. Find ended events past their expiresAt — process up to MAX per tick.
	const expired = await db
		.select({
			id: schema.events.id,
			shortCode: schema.events.shortCode,
		})
		.from(schema.events)
		.where(
			and(
				eq(schema.events.status, 'ended'),
				lt(schema.events.expiresAt, new Date())
			)
		)
		.limit(MAX_EVENTS_PER_TICK)

	for (const ev of expired) {
		try {
			const photos = await db
				.select({
					id: schema.photos.id,
					cfImagesId: schema.photos.cfImagesId,
					r2OriginalKey: schema.photos.r2OriginalKey,
				})
				.from(schema.photos)
				.where(eq(schema.photos.eventId, ev.id))

			for (const photo of photos) {
				const errs = await deletePhotoAssets(env, photo)
				result.errors += errs
				result.photosDeleted++
			}

			// Cascades to photo rows. event_purchases FKs are `set null` so
			// bookkeeping survives (see schema comment).
			await db.delete(schema.events).where(eq(schema.events.id, ev.id))
			result.eventsDeleted++
		} catch (e) {
			console.error(`Cleanup failed for event ${ev.id} (${ev.shortCode}):`, e)
			result.errors++
		}
	}

	return result
}

export type PhotoAssetRef = {
	cfImagesId: string | null
	r2OriginalKey: string | null
}

// Deletes a single photo's external assets (Cloudflare Images + R2). Does NOT
// remove the D1 row — the caller decides whether to delete it or just orphan
// it (the cron-deletion path cascades from the event row instead).
// Returns the number of asset-deletion errors so the caller can accumulate.
export async function deletePhotoAssets(
	env: Cloudflare.Env,
	photo: PhotoAssetRef
): Promise<number> {
	let errors = 0
	if (photo.cfImagesId) {
		try {
			await deleteFromCloudflareImages(env, photo.cfImagesId)
		} catch (e) {
			console.warn(`CF Images delete failed for ${photo.cfImagesId}:`, e)
			errors++
		}
	}
	if (photo.r2OriginalKey) {
		try {
			await env.PHOTOS_BUCKET.delete(photo.r2OriginalKey)
		} catch (e) {
			console.warn(`R2 delete failed for ${photo.r2OriginalKey}:`, e)
			errors++
		}
	}
	return errors
}

async function deleteFromCloudflareImages(env: Cloudflare.Env, imageId: string): Promise<void> {
	const r = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${env.CF_IMAGES_ACCOUNT_ID}/images/v1/${imageId}`,
		{
			method: 'DELETE',
			headers: { Authorization: `Bearer ${env.CF_IMAGES_API_TOKEN}` },
		}
	)
	// 404 means the image is already gone — fine for our purposes.
	if (!r.ok && r.status !== 404) {
		throw new Error(`CF Images returned ${r.status}: ${await r.text()}`)
	}
}
