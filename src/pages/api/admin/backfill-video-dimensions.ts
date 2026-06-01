import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { and, eq, isNotNull } from 'drizzle-orm'
import * as schema from '../../../db/schema'

export const prerender = false

// Host-scoped one-off backfill for every video the caller hosts:
//   1. Pulls width/height from Cloudflare Stream and writes them to the row
//      if missing (so the photo wall can do object-fit cover sizing).
//   2. Triggers MP4-download generation so the event zip can include the
//      video later. Safe to call repeatedly — Stream returns 200 for an
//      already-enabled download too.
export const POST: APIRoute = async ({ locals }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })
	if (!env.CF_STREAM_ACCOUNT_ID || !env.CF_STREAM_API_TOKEN) {
		return new Response('Stream API not configured', { status: 500 })
	}

	const db = drizzle(env.DB, { schema })
	const rows = await db
		.select({
			id: schema.photos.id,
			cfStreamUid: schema.photos.cfStreamUid,
			mediaWidth: schema.photos.mediaWidth,
		})
		.from(schema.photos)
		.innerJoin(schema.events, eq(schema.photos.eventId, schema.events.id))
		.where(
			and(
				eq(schema.events.hostId, host.id),
				eq(schema.photos.mediaType, 'video'),
				isNotNull(schema.photos.cfStreamUid)
			)
		)

	let dimensionsUpdated = 0
	let mp4Triggered = 0
	let failed = 0
	const results: {
		id: string
		width: number | null
		height: number | null
		mp4Ok: boolean
		ok: boolean
	}[] = []

	for (const row of rows) {
		if (!row.cfStreamUid) continue
		let width: number | null = null
		let height: number | null = null
		let mp4Ok = false
		try {
			// 1. Get metadata (only if dimensions missing).
			if (!row.mediaWidth) {
				const r = await fetch(
					`https://api.cloudflare.com/client/v4/accounts/${env.CF_STREAM_ACCOUNT_ID}/stream/${row.cfStreamUid}`,
					{ headers: { Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}` } }
				)
				if (r.ok) {
					const payload = (await r.json()) as {
						result?: { input?: { width?: number; height?: number } }
					}
					width =
						typeof payload?.result?.input?.width === 'number'
							? payload.result.input.width
							: null
					height =
						typeof payload?.result?.input?.height === 'number'
							? payload.result.input.height
							: null
					if (width && height) {
						await db
							.update(schema.photos)
							.set({ mediaWidth: width, mediaHeight: height })
							.where(eq(schema.photos.id, row.id))
						dimensionsUpdated++
					}
				}
			}

			// 2. Trigger MP4 download generation. Stream returns 200 even if the
			// download is already enabled — safe to call repeatedly.
			const mp4Res = await fetch(
				`https://api.cloudflare.com/client/v4/accounts/${env.CF_STREAM_ACCOUNT_ID}/stream/${row.cfStreamUid}/downloads`,
				{
					method: 'POST',
					headers: { Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}` },
				}
			)
			mp4Ok = mp4Res.ok
			if (mp4Ok) mp4Triggered++

			results.push({ id: row.id, width, height, mp4Ok, ok: true })
		} catch (e) {
			failed++
			results.push({ id: row.id, width, height, mp4Ok, ok: false })
			console.error('backfill failed for', row.id, e)
		}
	}

	return Response.json({
		scanned: rows.length,
		dimensionsUpdated,
		mp4Triggered,
		failed,
		results,
	})
}
