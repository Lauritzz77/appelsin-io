import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { sendTransactionalEmail } from './email'
import { isLocale, type Locale } from './i18n'

const magicLinkEmail = {
	en: {
		subject: 'Sign in to appelsin',
		html: (url: string) =>
			`<p>Click to sign in to appelsin: <a href="${url}">${url}</a></p><p>This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
	},
	da: {
		subject: 'Log ind på appelsin',
		html: (url: string) =>
			`<p>Klik for at logge ind på appelsin: <a href="${url}">${url}</a></p><p>Linket udløber om 15 minutter. Hvis du ikke har bedt om det, kan du ignorere denne email.</p>`,
	},
} satisfies Record<Locale, { subject: string; html: (url: string) => string }>

function localeFromMagicLinkRequest(
	metadata: Record<string, unknown> | undefined,
	ctx: unknown
): Locale {
	if (isLocale(metadata?.locale)) return metadata.locale

	const headers =
		ctx && typeof ctx === 'object' && 'headers' in ctx ? (ctx.headers as Headers | undefined) : undefined
	const acceptLanguage = headers?.get('accept-language')?.toLowerCase()
	if (acceptLanguage?.split(',').some((lang) => lang.trim().startsWith('da'))) return 'da'

	return 'en'
}

function authBaseURL(env: Cloudflare.Env, requestUrl?: string | URL): string {
	// Only honour the request origin when it's in the known allow-list; otherwise
	// pin to PUBLIC_APP_URL. Echoing an arbitrary request origin would make the
	// CSRF/origin check self-referential and let a spoofed Host be auto-trusted.
	const allowed = new Set([env.PUBLIC_APP_URL, 'http://localhost:4321', 'http://localhost:4322'])
	if (requestUrl) {
		const origin = new URL(requestUrl).origin
		if (allowed.has(origin)) return origin
	}
	return env.PUBLIC_APP_URL
}

export function createAuth(env: Cloudflare.Env, requestUrl?: string | URL) {
	const db = drizzle(env.DB, { schema })
	const baseURL = authBaseURL(env, requestUrl)
	// Build trusted origins from the fixed allow-list (not the request origin),
	// so the origin check can't be satisfied by a spoofed Host header.
	const trustedOrigins = Array.from(
		new Set([env.PUBLIC_APP_URL, 'http://localhost:4321', 'http://localhost:4322'])
	)

	return betterAuth({
		baseURL,
		// Accept both common Astro dev ports as trusted in addition to baseURL;
		// real prod traffic only matches PUBLIC_APP_URL so these are no-ops there.
		trustedOrigins,
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, {
			provider: 'sqlite',
			schema: {
				user: schema.hosts,
				session: schema.sessions,
				account: schema.accounts,
				verification: schema.verifications,
			},
		}),
		user: {
			additionalFields: {
				stripeCustomerId: { type: 'string', required: false },
				plan: { type: 'string', defaultValue: 'free', required: false },
			},
		},
		plugins: [
			magicLink({
				sendMagicLink: async ({ email, url, metadata }, ctx) => {
					const locale = localeFromMagicLinkRequest(metadata, ctx)
					const copy = magicLinkEmail[locale]
					await sendTransactionalEmail(
						{
							from: env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
							to: email,
							subject: copy.subject,
							html: copy.html(url),
						},
						env.RESEND_API_KEY
					)
				},
			}),
		],
	})
}

export type Auth = ReturnType<typeof createAuth>
