import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { createAuth } from './lib/auth'

export const onRequest = defineMiddleware(async (context, next) => {
	const path = context.url.pathname

	if (path.startsWith('/api/auth/')) return next()

	try {
		const auth = createAuth(env)
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

	if (path.startsWith('/app') && !context.locals.host) {
		return context.redirect('/login', 302)
	}
	if ((path === '/login' || path === '/signup') && context.locals.host) {
		return context.redirect('/app', 302)
	}

	return next()
})
