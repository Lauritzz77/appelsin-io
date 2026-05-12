/// <reference types="astro/client" />

declare namespace Cloudflare {
	interface Env {
		BETTER_AUTH_SECRET: string
		RESEND_API_KEY?: string
		RESEND_FROM_EMAIL?: string
		STRIPE_SECRET_KEY: string
		STRIPE_WEBHOOK_SECRET: string
	}
}

type Runtime = import('@astrojs/cloudflare').Runtime<Cloudflare.Env>

declare namespace App {
	interface Locals extends Runtime {
		host?: {
			id: string
			email: string
			plan: string
		}
	}
}
