import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { runRetentionCleanup } from '../../../lib/cleanup'

export const prerender = false

// Dev-only: trigger the retention cleanup that normally runs hourly via cron.
// Use to verify event end/expiry behaviour without waiting an hour.
export const POST: APIRoute = async ({ locals }) => {
	if (!import.meta.env.DEV) return new Response('Not found', { status: 404 })

	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const start = Date.now()
	const result = await runRetentionCleanup(env)
	return Response.json({ ...result, ms: Date.now() - start })
}
