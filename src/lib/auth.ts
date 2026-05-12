import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { sendTransactionalEmail } from './email'

export function createAuth(env: Cloudflare.Env) {
	const db = drizzle(env.DB, { schema })

	return betterAuth({
		baseURL: env.PUBLIC_APP_URL,
		// Accept both common Astro dev ports as trusted in addition to baseURL;
		// real prod traffic only matches PUBLIC_APP_URL so these are no-ops there.
		trustedOrigins: [env.PUBLIC_APP_URL, 'http://localhost:4321', 'http://localhost:4322'],
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
				sendMagicLink: async ({ email, url }) => {
					await sendTransactionalEmail(
						{
							from: env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
							to: email,
							subject: 'Sign in to appelsin',
							html: `<p>Click to sign in to appelsin: <a href="${url}">${url}</a></p><p>This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
						},
						env.RESEND_API_KEY
					)
				},
			}),
		],
	})
}

export type Auth = ReturnType<typeof createAuth>
