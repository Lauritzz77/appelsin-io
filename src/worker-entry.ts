// Custom Worker entrypoint: re-exports Astro's fetch handler and ships the
// EventChannel Durable Object class alongside it. wrangler.jsonc's `main`
// points here.
import server from '@astrojs/cloudflare/entrypoints/server'
import { DurableObject } from 'cloudflare:workers'
import { runRetentionCleanup } from './lib/cleanup'

type ClientHello = { type: 'hello' }
type ClientMessage = ClientHello

export type NewPhotoMessage = {
	type: 'new-photo'
	photoId: string
	mediaType: 'photo' | 'video'
	cfImagesId: string | null
	cfStreamUid: string | null
	durationSeconds: number | null
	createdAt: number
	uploaderName: string | null
	mediaWidth: number | null
	mediaHeight: number | null
}

export type DeletePhotoMessage = {
	type: 'delete-photo'
	photoId: string
}

export type ServerMessage = NewPhotoMessage | DeletePhotoMessage | { type: 'ack' }

export class EventChannel extends DurableObject<Cloudflare.Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		if (url.pathname === '/ws') {
			if (request.headers.get('upgrade') !== 'websocket') {
				return new Response('Expected WebSocket upgrade', { status: 426 })
			}
			const pair = new WebSocketPair()
			const [client, server] = [pair[0], pair[1]]
			this.ctx.acceptWebSocket(server)
			return new Response(null, { status: 101, webSocket: client })
		}

		if (url.pathname === '/notify' && request.method === 'POST') {
			const payload = (await request.json()) as NewPhotoMessage | DeletePhotoMessage
			const body = JSON.stringify(payload)
			let delivered = 0
			for (const ws of this.ctx.getWebSockets()) {
				try {
					ws.send(body)
					delivered++
				} catch {
					// dead socket — runtime cleans up
				}
			}
			return Response.json({ delivered })
		}

		return new Response('Not found', { status: 404 })
	}

	override async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
		if (typeof message !== 'string') return
		try {
			const msg = JSON.parse(message) as ClientMessage
			if (msg.type === 'hello') ws.send(JSON.stringify({ type: 'ack' } satisfies ServerMessage))
		} catch {
			// ignore malformed
		}
	}

	override async webSocketClose(ws: WebSocket, code: number, reason: string) {
		ws.close(code, reason)
	}
}

export default {
	fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
		return server.fetch(request, env, ctx)
	},
	async scheduled(_controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
		ctx.waitUntil(
			(async () => {
				const start = Date.now()
				try {
					const result = await runRetentionCleanup(env)
					console.log('Retention cleanup:', { ...result, ms: Date.now() - start })
				} catch (e) {
					console.error('Retention cleanup threw:', e)
				}
			})()
		)
	},
} satisfies ExportedHandler<Cloudflare.Env>
