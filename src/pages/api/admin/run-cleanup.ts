import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { runRetentionCleanup } from '../../../lib/cleanup'

export const prerender = false

// Host-gated trigger for the retention cleanup cron. Lets us test the
// post-event email flow on demand without waiting for the hourly trigger.
// Returns the same result the cron would print to logs.
export const POST: APIRoute = async ({ locals }) => {
	if (!locals.host) return new Response('Unauthorized', { status: 401 })
	const result = await runRetentionCleanup(env)
	return Response.json(result)
}
