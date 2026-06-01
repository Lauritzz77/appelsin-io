<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
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

// "Object-fit cover" emulation for the CF Stream iframe: blow up the iframe
// so its letterbox bars fall outside the tile. Computes width/height percent
// relative to a square tile based on the video's stored aspect ratio.
function videoFrameStyle(p: Photo): Record<string, string> {
	if (!p.mediaWidth || !p.mediaHeight) {
		// Unknown aspect → fit iframe to tile. CF Stream player letterboxes
		// inside, so video is preserved but bars may appear.
		return { width: '100%', height: '100%' }
	}
	const aspect = p.mediaWidth / p.mediaHeight
	const aspectRatio = `${p.mediaWidth} / ${p.mediaHeight}`
	if (aspect >= 1) {
		// Landscape: fill tile height, let width grow per video aspect → covers
		return { height: '100%', width: 'auto', aspectRatio, minWidth: '100%' }
	}
	// Portrait: fill tile width, let height grow per video aspect → covers
	return { width: '100%', height: 'auto', aspectRatio, minHeight: '100%' }
}

const props = withDefaults(
	defineProps<{
		code: string
		initialPhotos: Photo[]
		cfImagesHash: string
		qrDataUrl: string
		streamDomain?: string
		// When false, video tiles render as static thumbnails instead of the
		// iframe player. Used for ended events so we don't burn Stream-delivery
		// minutes on a wall that no one is updating.
		isLive?: boolean
	}>(),
	{ streamDomain: 'videodelivery.net', isLive: true }
)

// Static masonry-ish grid. 9 tile positions: one 2×2 hero + eight 1×1, fits
// exactly in a 4-col × 3-row grid. Pool of up to 20 photos (10 newest + 10
// random from the rest). All 9 tiles flip to the next 9 pool photos at every
// tick (default 30 s), staggered so the swap reads as a wave instead of one
// abrupt blink.
const TILE_COUNT = 9
const ROTATION_MS = 15_000
const STAGGER_MS = 180

// Each entry describes a tile's grid-column / grid-row span. 4 cols × 3 rows
// = 12 cells; the 2×2 hero takes 4, the remaining 8 single-cell tiles fill
// the rest.
const TILE_SPANS: { col: number; row: number }[] = [
	{ col: 2, row: 2 }, // hero top-left
	{ col: 1, row: 1 },
	{ col: 1, row: 1 },
	{ col: 1, row: 1 },
	{ col: 1, row: 1 },
	{ col: 1, row: 1 },
	{ col: 1, row: 1 },
	{ col: 1, row: 1 },
	{ col: 1, row: 1 },
]

const pool = ref<Photo[]>([...props.initialPhotos])
const tilePhotos = ref<(Photo | null)[]>(
	Array.from({ length: TILE_COUNT }, (_, i) => props.initialPhotos[i % Math.max(1, props.initialPhotos.length)] ?? null)
)
let nextTileIdx = 0
let nextPoolIdx = Math.min(TILE_COUNT, props.initialPhotos.length) % Math.max(1, props.initialPhotos.length)
let rotationTimer: ReturnType<typeof setInterval> | null = null

function startRotation() {
	if (rotationTimer) clearInterval(rotationTimer)
	if (pool.value.length === 0) return
	rotationTimer = setInterval(() => {
		if (pool.value.length === 0) return
		// Swap ALL tiles in this tick, staggered so the flip reads as a wave.
		for (let k = 0; k < TILE_COUNT; k++) {
			const tileIdx = nextTileIdx
			const photo = pool.value[nextPoolIdx]
			setTimeout(() => {
				tilePhotos.value[tileIdx] = photo
			}, k * STAGGER_MS)
			nextTileIdx = (nextTileIdx + 1) % TILE_COUNT
			nextPoolIdx = (nextPoolIdx + 1) % pool.value.length
		}
	}, ROTATION_MS)
}

watch(
	() => pool.value.length,
	() => startRotation()
)

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
	// Surface the new upload immediately by snapping the next-to-rotate tile
	// to the new photo, then bumping the pool cursor past it.
	tilePhotos.value[nextTileIdx] = photo
	nextTileIdx = (nextTileIdx + 1) % TILE_COUNT
	nextPoolIdx = 1 % pool.value.length
}

function removePhoto(photoId: string) {
	pool.value = pool.value.filter((p) => p.id !== photoId)
	// Any tile showing the removed photo needs a replacement.
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
	connect()
	startRotation()
})

onBeforeUnmount(() => {
	if (reconnectTimer) clearTimeout(reconnectTimer)
	if (rotationTimer) clearInterval(rotationTimer)
	ws?.close()
})

const visibleTileCount = computed(() => Math.min(TILE_COUNT, Math.max(1, pool.value.length)))
</script>

<template>
	<div class="collage">
		<div class="brand">
			<img src="/logo.svg" alt="appelsin.io" class="brand-logo" />
		</div>

		<div class="grid">
			<div
				v-for="i in visibleTileCount"
				:key="i - 1"
				class="tile"
				:style="{
					gridColumn: `span ${TILE_SPANS[i - 1].col}`,
					gridRow: `span ${TILE_SPANS[i - 1].row}`,
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
	width: 100vw;
	height: 100vh;
	overflow: hidden;
	background: #071952;
	box-sizing: border-box;
}

.brand {
	position: absolute;
	top: clamp(16px, 2.5vh, 32px);
	left: clamp(16px, 2.5vw, 32px);
	z-index: 20;
}

.brand-logo {
	width: clamp(56px, 6vw, 96px);
	height: auto;
}

.grid {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	grid-template-rows: repeat(3, 1fr);
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
	font-size: clamp(8px, 0.8vw, 12px);
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
	right: clamp(12px, 1.5vw, 24px);
	bottom: clamp(12px, 1.5vh, 24px);
	width: clamp(56px, 6vw, 96px);
	height: clamp(56px, 6vw, 96px);
	background: rgba(255, 255, 255, 0.94);
	padding: clamp(5px, 0.6vw, 9px);
	border-radius: clamp(10px, 1.2vw, 18px);
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

/* 3D-rotate on photo swap. Old photo flips out, new one flips in. */
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
