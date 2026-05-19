<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

type Photo = { id: string; cfImagesId: string | null; createdAt: number }

const props = defineProps<{
	code: string
	initialPhotos: Photo[]
	cfImagesHash: string
	qrDataUrl: string
}>()

// Four lanes spanning the viewport with 1vw gaps. Each slot's random size is
// 80–100% of its lane width, so photos always fill most of their lane while
// the gaps guarantee no horizontal overlap with neighbours.
type Lane = { leftVw: number; widthVw: number }
const LANES: readonly Lane[] = [
	{ leftVw: 1,  widthVw: 18 }, // 1  → 19
	{ leftVw: 20, widthVw: 28 }, // 20 → 48
	{ leftVw: 49, widthVw: 22 }, // 49 → 71
	{ leftVw: 72, widthVw: 27 }, // 72 → 99
]
const SLOT_COUNT = LANES.length

const slots = ref<(Photo | null)[]>(
	Array.from({ length: SLOT_COUNT }, (_, i) => props.initialPhotos[i] ?? null)
)

// Square edge length and fall duration are re-rolled on every iteration so
// no two loops feel the same. Size always lands between 80% and 100% of the
// slot's lane width.
const DUR_MIN_S = 30
const DUR_MAX_S = 55
const LANE_FILL_MIN = 0.8
const LANE_FILL_MAX = 1.0

function randomSize(laneIdx: number): number {
	const lane = LANES[laneIdx].widthVw
	return lane * (LANE_FILL_MIN + Math.random() * (LANE_FILL_MAX - LANE_FILL_MIN))
}

function randomDuration(): number {
	return DUR_MIN_S + Math.random() * (DUR_MAX_S - DUR_MIN_S)
}

const sizes = ref<number[]>(Array.from({ length: SLOT_COUNT }, (_, i) => randomSize(i)))
const durations = ref<number[]>(Array.from({ length: SLOT_COUNT }, () => randomDuration()))

// Initial delays stagger the slots so the screen is never empty at first
// paint. Computed once; subsequent cycles chain on duration alone.
const initialDelays = Array.from(
	{ length: SLOT_COUNT },
	(_, i) => -Math.random() * durations.value[i]
)

function onSlotIteration(i: number, e: AnimationEvent) {
	// animationiteration fires for *any* animation on the element — guard for
	// the fall loop so the photo's enter/leave transitions don't trigger us.
	if (e.animationName === 'fall') {
		sizes.value[i] = randomSize(i)
		durations.value[i] = randomDuration()
	}
}

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function findReplacementIdx(): number {
	const emptyIdx = slots.value.findIndex((s) => s === null)
	if (emptyIdx >= 0) return emptyIdx
	let oldestIdx = 0
	let oldestAt = Number.POSITIVE_INFINITY
	for (let i = 0; i < slots.value.length; i++) {
		const at = slots.value[i]?.createdAt ?? 0
		if (at < oldestAt) {
			oldestAt = at
			oldestIdx = i
		}
	}
	return oldestIdx
}

function addPhoto(photo: Photo) {
	if (slots.value.some((s) => s?.id === photo.id)) return
	const idx = findReplacementIdx()
	slots.value[idx] = photo
}

function connect() {
	const proto = location.protocol === 'https:' ? 'wss' : 'ws'
	ws = new WebSocket(`${proto}://${location.host}/api/display-socket?code=${props.code}`)

	ws.onopen = () => ws?.send(JSON.stringify({ type: 'hello' }))
	ws.onmessage = (e) => {
		try {
			const msg = JSON.parse(e.data) as
				| { type: 'new-photo'; photoId: string; cfImagesId: string | null; createdAt: number }
				| { type: 'ack' }
			if (msg.type === 'new-photo') {
				addPhoto({
					id: msg.photoId,
					cfImagesId: msg.cfImagesId,
					createdAt: msg.createdAt,
				})
			}
		} catch {
			// ignore malformed
		}
	}
	ws.onclose = () => {
		reconnectTimer = setTimeout(connect, 2000)
	}
	ws.onerror = () => ws?.close()
}

function imageUrl(cfImagesId: string | null): string {
	if (!cfImagesId) {
		// Dev-injected photos render as a coloured rectangle so the layout is visible.
		return `data:image/svg+xml,${encodeURIComponent(
			`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='hsl(${Math.floor(
				Math.random() * 360
			)},70%,55%)'/></svg>`
		)}`
	}
	return `https://imagedelivery.net/${props.cfImagesHash}/${cfImagesId}/public`
}

onMounted(() => {
	connect()
})

onBeforeUnmount(() => {
	if (reconnectTimer) clearTimeout(reconnectTimer)
	ws?.close()
})
</script>

<template>
	<div class="collage">
		<div class="brand">
			<img src="/logo.svg" alt="appelsin.io" class="brand-logo" />
		</div>

		<div class="stage">
			<div
				v-for="(photo, i) in slots"
				:key="i"
				class="slot"
				:style="{
					left: `${LANES[i].leftVw}vw`,
					width: `${sizes[i]}vw`,
					animationDuration: `${durations[i]}s`,
					animationDelay: `${initialDelays[i]}s`,
				}"
				@animationiteration="onSlotIteration(i, $event)"
			>
				<Transition name="photo">
					<img
						v-if="photo"
						:key="photo.id"
						:src="imageUrl(photo.cfImagesId)"
						alt=""
						class="slot-img"
					/>
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

.stage {
	position: absolute;
	inset: 0;
}

.slot {
	position: absolute;
	top: 0;
	overflow: hidden;
	border-radius: 4px;
	aspect-ratio: 1 / 1;
	animation-name: fall;
	animation-timing-function: linear;
	animation-iteration-count: infinite;
	/* left + width + duration + delay are set inline per slot (lane-bounded,
	 * randomised per loop) */
}

.slot-img {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

/* Each slot streams its photo top-to-bottom across the viewport, looping.
 * Translation is on the slot wrapper, so the inner <img>'s enter/leave
 * transition still works when a new upload replaces the photo mid-cycle.
 * Staggered durations + negative delays mean photos enter at different
 * vertical positions so the screen is never empty.
 * Scale also breathes through the cycle: small at the edges, full size in
 * the middle — gives a slight "drawing closer / receding" depth cue. */
@keyframes fall {
	0%   { transform: translateY(-100vh) scale(0.85); }
	50%  { transform: translateY(0)      scale(1.0);  }
	100% { transform: translateY(100vh)  scale(0.85); }
}

@media (prefers-reduced-motion: reduce) {
	.slot {
		animation: none;
	}
}

.qr {
	position: absolute;
	right: clamp(16px, 2vw, 32px);
	bottom: clamp(16px, 2vh, 32px);
	width: clamp(96px, 10vw, 144px);
	height: clamp(96px, 10vw, 144px);
	background: white;
	padding: clamp(4px, 0.5vw, 8px);
	border-radius: 8px;
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
	background: white;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
}

.qr-logo img {
	width: 100%;
	height: 100%;
}

.photo-enter-active {
	transition: opacity 0.6s ease-out, transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.photo-enter-from {
	opacity: 0;
	transform: scale(0.85);
}
.photo-leave-active {
	transition: opacity 0.6s ease-out;
	position: absolute;
	inset: 0;
}
.photo-leave-to {
	opacity: 0;
}
</style>
