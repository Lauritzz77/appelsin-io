export type MediaType = 'photo' | 'video'

export type MediaItem = {
	id: string
	mediaType: MediaType
	cfImagesId: string | null
	cfStreamUid: string | null
	durationSeconds: number | null
	createdAt: number
}

export function streamThumbnailUrl(uid: string, domain = 'videodelivery.net'): string {
	return `https://${domain}/${uid}/thumbnails/thumbnail.jpg?time=1s&height=640`
}

export function streamIframeUrl(uid: string, domain = 'iframe.videodelivery.net'): string {
	const host = domain === 'videodelivery.net' ? 'iframe.videodelivery.net' : domain
	const path = host === 'iframe.videodelivery.net' ? uid : `${uid}/iframe`
	const params = new URLSearchParams({
		autoplay: 'true',
		muted: 'true',
		loop: 'true',
		controls: 'false',
		letterboxColor: 'transparent',
	})
	return `https://${host}/${path}?${params.toString()}`
}
