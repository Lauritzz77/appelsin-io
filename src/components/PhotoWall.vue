<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { FONTS, type EventBranding } from '../lib/branding'
import { streamIframeUrl, streamThumbnailUrl } from '../lib/media'

type Photo = {
	id: string
	mediaType: 'photo' | 'video'
	cfImagesId: string | null
	cfStreamUid: string | null
	durationSeconds: number | null
	createdAt: number
	uploaderName: string | null
	mediaWidth: number | null
	mediaHeight: number | null
}

function videoFrameStyle(p: Photo): Record<string, string> {
	if (!p.mediaWidth || !p.mediaHeight) return { width: '100%', height: '100%' }
	const aspect = p.mediaWidth / p.mediaHeight
	const aspectRatio = `${p.mediaWidth} / ${p.mediaHeight}`
	if (aspect >= 1) {
		return { height: '100%', width: 'auto', aspectRatio, minWidth: '100%' }
	}
	return { width: '100%', height: 'auto', aspectRatio, minHeight: '100%' }
}

const props = withDefaults(
	defineProps<{
		code: string
		initialPhotos: Photo[]
		cfImagesHash: string
		branding: EventBranding
		qrDataUrl: string
		streamDomain?: string
		// Editor preview passes false so it doesn't open a second WebSocket
		// against the same Durable Object. Default true for the live wall.
		connectWebsocket?: boolean
		// When false, video tiles render as static thumbnails (no playback).
		isLive?: boolean
	}>(),
	{ connectWebsocket: true, streamDomain: 'videodelivery.net', isLive: true }
)

const font = computed(() => FONTS[props.branding.font])

// Density drives the wall layout (matches the Claude-Design "redo" prototype):
//   small  → dense grid of many small tiles, no hero
//   medium → standard 2×2 hero + 8 tiles
//   large  → cinematic 2×2 hero + 2 tiles
type Layout = { cols: number; rows: number; count: number; hero: boolean }
const LAYOUTS: Record<string, Layout> = {
	small: { cols: 5, rows: 3, count: 15, hero: false },
	medium: { cols: 4, rows: 3, count: 9, hero: true },
	large: { cols: 3, rows: 2, count: 3, hero: true },
}
const layout = computed<Layout>(() => LAYOUTS[props.branding.density] ?? LAYOUTS.medium)
const tileCount = computed(() => layout.value.count)
const tileSpans = computed(() => {
	const n = layout.value.count
	if (layout.value.hero) {
		return [{ col: 2, row: 2 }, ...Array.from({ length: n - 1 }, () => ({ col: 1, row: 1 }))]
	}
	return Array.from({ length: n }, () => ({ col: 1, row: 1 }))
})

const ROTATION_MS = 15_000
const STAGGER_MS = 180

const pool = ref<Photo[]>([...props.initialPhotos])
function buildTileArray(n: number): (Photo | null)[] {
	const len = Math.max(1, pool.value.length)
	return Array.from({ length: n }, (_, i) => pool.value[i % len] ?? null)
}
const tilePhotos = ref<(Photo | null)[]>(buildTileArray(tileCount.value))
let nextTileIdx = 0
let nextPoolIdx = Math.min(tileCount.value, props.initialPhotos.length) % Math.max(1, props.initialPhotos.length)
let rotationTimer: ReturnType<typeof setInterval> | null = null

function startRotation() {
	if (rotationTimer) clearInterval(rotationTimer)
	if (pool.value.length === 0) return
	rotationTimer = setInterval(() => {
		if (pool.value.length === 0) return
		const n = tileCount.value
		for (let k = 0; k < n; k++) {
			const tileIdx = nextTileIdx
			const photo = pool.value[nextPoolIdx]
			setTimeout(() => {
				tilePhotos.value[tileIdx] = photo
			}, k * STAGGER_MS)
			nextTileIdx = (nextTileIdx + 1) % n
			nextPoolIdx = (nextPoolIdx + 1) % pool.value.length
		}
	}, ROTATION_MS)
}

watch(
	() => pool.value.length,
	() => startRotation()
)

// When the density (and thus tile count) changes, rebuild the tile array so
// the new grid fills immediately, then restart the rotation cursor.
watch(tileCount, (n) => {
	tilePhotos.value = buildTileArray(n)
	nextTileIdx = 0
	nextPoolIdx = Math.min(n, pool.value.length) % Math.max(1, pool.value.length)
	startRotation()
})

function imageUrl(cfImagesId: string | null): string {
	if (!cfImagesId) {
		return `data:image/svg+xml,${encodeURIComponent(
			`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='hsl(${Math.floor(
				Math.random() * 360
			)},70%,55%)'/></svg>`
		)}`
	}
	return `https://imagedelivery.net/${props.cfImagesHash}/${cfImagesId}/public`
}

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function addPhoto(photo: Photo) {
	if (pool.value.some((p) => p.id === photo.id)) return
	pool.value = [photo, ...pool.value].slice(0, 20)
	tilePhotos.value[nextTileIdx] = photo
	nextTileIdx = (nextTileIdx + 1) % tileCount.value
	nextPoolIdx = 1 % pool.value.length
}

function removePhoto(photoId: string) {
	pool.value = pool.value.filter((p) => p.id !== photoId)
	for (let i = 0; i < tilePhotos.value.length; i++) {
		if (tilePhotos.value[i]?.id === photoId) {
			tilePhotos.value[i] = pool.value[i % Math.max(1, pool.value.length)] ?? null
		}
	}
}

function connect() {
	const proto = location.protocol === 'https:' ? 'wss' : 'ws'
	ws = new WebSocket(`${proto}://${location.host}/api/display-socket?code=${props.code}`)
	ws.onopen = () => ws?.send(JSON.stringify({ type: 'hello' }))
	ws.onmessage = (e) => {
		try {
			const msg = JSON.parse(e.data) as
				| {
						type: 'new-photo'
						photoId: string
						mediaType: 'photo' | 'video'
						cfImagesId: string | null
						cfStreamUid: string | null
						durationSeconds: number | null
						createdAt: number
						uploaderName: string | null
						mediaWidth: number | null
						mediaHeight: number | null
				  }
				| { type: 'delete-photo'; photoId: string }
				| { type: 'ack' }
			if (msg.type === 'new-photo') {
				addPhoto({
					id: msg.photoId,
					mediaType: msg.mediaType,
					cfImagesId: msg.cfImagesId,
					cfStreamUid: msg.cfStreamUid,
					durationSeconds: msg.durationSeconds,
					createdAt: msg.createdAt,
					uploaderName: msg.uploaderName ?? null,
					mediaWidth: msg.mediaWidth ?? null,
					mediaHeight: msg.mediaHeight ?? null,
				})
			} else if (msg.type === 'delete-photo') {
				removePhoto(msg.photoId)
			}
		} catch {
			/* ignore malformed */
		}
	}
	ws.onclose = () => {
		reconnectTimer = setTimeout(connect, 2000)
	}
	ws.onerror = () => ws?.close()
}

onMounted(() => {
	if (props.connectWebsocket) connect()
	startRotation()
})

onBeforeUnmount(() => {
	if (reconnectTimer) clearTimeout(reconnectTimer)
	if (rotationTimer) clearInterval(rotationTimer)
	ws?.close()
})

const collageStyle = computed(() => ({
	background: props.branding.background,
	color: props.branding.text,
	'--theme-heading-font': font.value.family,
	'--theme-heading-weight': String(font.value.headlineWeight),
	'--theme-heading-transform': font.value.headlineTransform,
	'--theme-heading-tracking': font.value.headlineTracking,
}))
const gridStyle = computed(() => ({
	gridTemplateColumns: `repeat(${layout.value.cols}, 1fr)`,
	gridTemplateRows: `repeat(${layout.value.rows}, 1fr)`,
}))

const title = computed(() => props.branding.titleOverlay)
const visibleTileCount = computed(() => Math.min(tileCount.value, Math.max(1, pool.value.length)))
</script>

<template>
	<div class="collage" :style="collageStyle">
		<div
			v-if="title.enabled && (title.line1 || title.line2)"
			class="title-overlay"
		>
			<div v-if="title.line1" class="title-line1">{{ title.line1 }}</div>
			<div v-if="title.line2" class="title-line2">{{ title.line2 }}</div>
		</div>

		<div class="grid" :style="gridStyle">
			<div
				v-for="i in visibleTileCount"
				:key="i - 1"
				class="tile"
				:style="{
					gridColumn: `span ${tileSpans[i - 1].col}`,
					gridRow: `span ${tileSpans[i - 1].row}`,
				}"
			>
				<Transition name="swap">
					<div v-if="tilePhotos[i - 1]" :key="tilePhotos[i - 1]!.id" class="tile-media">
						<img
							v-if="tilePhotos[i - 1]!.mediaType === 'photo'"
							:src="imageUrl(tilePhotos[i - 1]!.cfImagesId)"
							alt=""
							class="tile-img"
						/>
						<img
							v-else-if="tilePhotos[i - 1]!.cfStreamUid && !props.isLive"
							:src="streamThumbnailUrl(tilePhotos[i - 1]!.cfStreamUid!, props.streamDomain)"
							alt=""
							class="tile-img"
						/>
						<iframe
							v-else-if="tilePhotos[i - 1]!.cfStreamUid"
							:src="streamIframeUrl(tilePhotos[i - 1]!.cfStreamUid!, props.streamDomain)"
							class="tile-video-frame"
							:style="videoFrameStyle(tilePhotos[i - 1]!)"
							allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
							allowfullscreen
						></iframe>
						<span v-if="tilePhotos[i - 1]!.mediaType === 'video'" class="video-pill">Video</span>
						<span v-if="tilePhotos[i - 1]!.uploaderName" class="uploader-name">{{ tilePhotos[i - 1]!.uploaderName }}</span>
					</div>
				</Transition>
			</div>
		</div>

		<div class="qr">
			<img :src="qrDataUrl" alt="Scan to upload a photo" class="qr-img" />
			<div class="qr-logo">
				<img src="/logo.svg" alt="" />
			</div>
		</div>
	</div>
</template>

<style scoped>
.collage {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
	box-sizing: border-box;
}

.title-overlay {
	position: absolute;
	top: clamp(8px, 2.5cqh, 32px);
	left: clamp(8px, 2.5cqw, 32px);
	z-index: 20;
	font-family: var(--theme-heading-font);
	text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
	pointer-events: none;
	max-width: 60cqw;
}

.title-line1 {
	font-size: clamp(1rem, 3.5cqw, 4rem);
	font-weight: var(--theme-heading-weight, 500);
	line-height: 1.05;
	text-transform: var(--theme-heading-transform, none);
	letter-spacing: var(--theme-heading-tracking, normal);
}

.title-line2 {
	font-size: clamp(0.6rem, 1.4cqw, 1.5rem);
	letter-spacing: 0.05em;
	opacity: 0.72;
	margin-top: 0.4rem;
}

.grid {
	display: grid;
	gap: 2px;
	width: 100%;
	height: 100%;
	grid-auto-flow: dense;
}

.tile {
	position: relative;
	overflow: hidden;
	background: rgba(255, 255, 255, 0.04);
	perspective: 1000px;
}

.tile-media,
.tile-img {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
}

.tile-img {
	object-fit: cover;
}

.tile-video-frame {
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	border: 0;
	pointer-events: none;
	/* width/height set inline based on video aspect (see videoFrameStyle) */
}

.video-pill {
	position: absolute;
	left: 6px;
	bottom: 6px;
	border-radius: 999px;
	background: rgba(8, 8, 12, 0.72);
	color: white;
	font-size: clamp(8px, 0.8cqw, 12px);
	font-weight: 600;
	line-height: 1;
	padding: 4px 6px;
	z-index: 2;
}

.uploader-name {
	position: absolute;
	right: 8px;
	bottom: 6px;
	background: transparent;
	color: white;
	font-family: 'Caveat', cursive;
	font-size: 22px;
	font-weight: 600;
	line-height: 1;
	text-shadow:
		0 1px 2px rgba(0, 0, 0, 0.6),
		0 2px 6px rgba(0, 0, 0, 0.45);
	max-width: 80%;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	z-index: 2;
	pointer-events: none;
}

.qr {
	position: absolute;
	right: clamp(8px, 2cqw, 32px);
	bottom: clamp(8px, 2cqh, 32px);
	width: clamp(40px, 6cqw, 96px);
	height: clamp(40px, 6cqw, 96px);
	background: rgba(255, 255, 255, 0.94);
	padding: clamp(4px, 0.7cqw, 8px);
	border-radius: clamp(8px, 1.4cqw, 18px);
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
	box-sizing: border-box;
	z-index: 20;
}

.qr-img {
	display: block;
	width: 100%;
	height: 100%;
}

.qr-logo {
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	width: 22%;
	height: 22%;
	background: #071952;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
}

.qr-logo img {
	width: 100%;
	height: 100%;
}

.tile-media {
	transform-style: preserve-3d;
	backface-visibility: hidden;
}
.swap-enter-active,
.swap-leave-active {
	transition: transform 0.55s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.55s ease;
}
.swap-enter-from {
	transform: rotateY(-180deg);
	opacity: 0;
}
.swap-leave-to {
	transform: rotateY(180deg);
	opacity: 0;
}
.swap-leave-active {
	position: absolute;
	inset: 0;
}
</style>
