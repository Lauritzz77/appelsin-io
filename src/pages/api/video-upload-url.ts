import type { APIRoute } from 'astro'

export const prerender = false

export const POST: APIRoute = async () => new Response('Video uploads are not available yet', { status: 403 })
