import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { eq, and } from 'drizzle-orm'
import * as schema from '../../../../db/schema'
import { generateQRPdf } from '../../../../lib/qr-pdf'

export const prerender = false

export const GET: APIRoute = async ({ params, locals }) => {
	const host = locals.host
	if (!host) return new Response('Unauthorized', { status: 401 })

	const id = params.id
	if (!id) return new Response('Missing event id', { status: 400 })

	const db = drizzle(env.DB, { schema })
	const [event] = await db
		.select()
		.from(schema.events)
		.where(and(eq(schema.events.id, id), eq(schema.events.hostId, host.id)))
		.limit(1)

	if (!event) return new Response('Event not found', { status: 404 })

	const pdfBytes = await generateQRPdf(event, env.PUBLIC_APP_URL)

	return new Response(pdfBytes as unknown as BodyInit, {
		status: 200,
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="${event.shortCode}-qr.pdf"`,
			'Cache-Control': 'private, no-cache',
		},
	})
}
