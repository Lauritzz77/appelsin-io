import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { createAuth } from './lib/auth'

export const onRequest = defineMiddleware(async (context, next) => {
	const path = context.url.pathname

	if (path.startsWith('/api/auth/')) return next()

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
		const requested = context.url.searchParams.get('next')
		const defaultDest = path.startsWith('/en/') ? '/en/app' : '/app'
		const dest = requested && requested.startsWith('/') ? requested : defaultDest
		return context.redirect(dest, 302)
	}

	return next()
})
