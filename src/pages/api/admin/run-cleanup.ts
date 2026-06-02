import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { runRetentionCleanup } from '../../../lib/cleanup'

export const prerender = false

// Host-gated trigger for the retention cleanup cron. Lets us test the
// post-event email flow on demand without waiting for the hourly trigger.
// Returns the same result the cron would print to logs.
export const POST: APIRoute = async ({ locals }) => {
	if (!locals.host) return new Response('Unauthorized', { status: 401 })
	// `locals.host` only means "logged in", and signup is open (passwordless
	// magic link), so gate this destructive cross-tenant job behind an explicit
	// admin allow-list. Fails closed when ADMIN_EMAILS is unset.
	const admins = (env.ADMIN_EMAILS ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
	if (!admins.includes(locals.host.email.toLowerCase())) {
		return new Response('Forbidden', { status: 403 })
	}
	const result = await runRetentionCleanup(env)
	return Response.json(result)
}
