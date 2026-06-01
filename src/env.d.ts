/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		host?: {
			id: string
			email: string
			plan: string
		}
	}
}

// Augment the wrangler-generated `Cloudflare.Env` with vars that may not yet
// be in `.dev.vars` (so the build stays green before `wrangler types` runs).
// These are Stripe Price IDs — set per environment via `.dev.vars` locally
// and `wrangler secret put` in prod.
declare namespace Cloudflare {
	interface Env {
		STRIPE_PRICE_PRO_MONTHLY: string
		STRIPE_PRICE_PRO_YEARLY: string
		CF_STREAM_ACCOUNT_ID: string
		CF_STREAM_API_TOKEN: string
		CF_STREAM_CUSTOMER_DOMAIN: string
	}
}

type AppDialogOptions = {
	title: string
	message?: string
	confirmText?: string
	cancelText?: string
	danger?: boolean
	input?: {
		label: string
		defaultValue?: string
		maxLength?: number
	}
}

type AppDialogResult = {
	confirmed: boolean
	value?: string
}

interface Window {
	AppDialog: {
		confirm(options: AppDialogOptions): Promise<boolean>
		prompt(options: AppDialogOptions & { input: NonNullable<AppDialogOptions['input']> }): Promise<string | null>
		alert(options: Omit<AppDialogOptions, 'cancelText' | 'input'>): Promise<void>
	}
}
