import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'

export const prerender = false

export const GET: APIRoute = async ({ request, url }) => {
	if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
		return new Response('Expected WebSocket upgrade', { status: 426 })
	}

	const code = url.searchParams.get('code')?.toUpperCase()
	if (!code) return new Response('Missing ?code', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select({ id: schema.events.id, status: schema.events.status })
		.from(schema.events)
		.where(eq(schema.events.shortCode, code))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })
	if (event.status !== 'live') return new Response('Event not live', { status: 403 })

	const stubId = env.EVENT_CHANNEL.idFromName(event.id)
	const stub = env.EVENT_CHANNEL.get(stubId)

	const doUrl = new URL(request.url)
	doUrl.pathname = '/ws'
	return stub.fetch(new Request(doUrl, request))
}
