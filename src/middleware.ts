import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { createAuth } from './lib/auth'
import { safeNext } from './lib/safe-next'

// Abuse-prone guest/upload endpoints that get edge rate-limiting.
const RATE_LIMITED_PREFIXES = [
	'/api/guest/',
	'/api/upload-url',
	'/api/video-upload-url',
	'/api/photo-uploaded',
	'/api/video-uploaded',
	'/api/display-socket',
]

export const onRequest = defineMiddleware(async (context, next) => {
	const path = context.url.pathname

	if (path.startsWith('/api/auth/')) return next()

	// Edge rate-limiting for the abuse-prone guest/upload endpoints. Guarded so
	// local dev (where the binding may be absent) still works.
	if (env.GUEST_RATE_LIMITER && RATE_LIMITED_PREFIXES.some((p) => path.startsWith(p))) {
		const ip = context.request.headers.get('cf-connecting-ip') ?? 'unknown'
		const { success } = await env.GUEST_RATE_LIMITER.limit({ key: `${ip}:${path}` })
		if (!success) return new Response('Too many requests', { status: 429 })
	}

	try {
		const auth = createAuth(env, context.url)
		const session = await auth.api.getSession({ headers: context.request.headers })
		if (session?.user) {
			context.locals.host = {
				id: session.user.id,
				email: session.user.email,
				plan: (session.user as { plan?: string }).plan ?? 'free',
			}
		}
	} catch (e) {
		console.error('Session check failed:', e)
	}

	if ((path.startsWith('/app') || path.startsWith('/en/app')) && !context.locals.host) {
		const next = context.url.pathname + context.url.search
		const loginPath = path.startsWith('/en/app') ? '/en/login' : '/login'
		return context.redirect(`${loginPath}?next=${encodeURIComponent(next)}`, 302)
	}
	if ((path === '/login' || path === '/signup' || path === '/en/login') && context.locals.host) {
		const defaultDest = path.startsWith('/en/') ? '/en/app' : '/app'
		const dest = safeNext(context.url.searchParams.get('next'), defaultDest)
		return context.redirect(dest, 302)
	}

	return next()
})
