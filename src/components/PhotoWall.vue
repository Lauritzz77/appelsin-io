<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { brandingToCssVars, type EventBranding } from '../lib/branding'

type Photo = { id: string; cfImagesId: string | null; createdAt: number }

const props = withDefaults(
	defineProps<{
		code: string
		initialPhotos: Photo[]
		cfImagesHash: string
		branding: EventBranding
		live?: boolean
	}>(),
	{ live: true }
)

const photos = ref<Photo[]>([...props.initialPhotos])
const connectionState = ref<'connecting' | 'open' | 'reconnecting'>('connecting')

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function connect() {
	const proto = location.protocol === 'https:' ? 'wss' : 'ws'
	ws = new WebSocket(`${proto}://${location.host}/api/display-socket?code=${props.code}`)

	ws.onopen = () => {
		connectionState.value = 'open'
		ws?.send(JSON.stringify({ type: 'hello' }))
	}
	ws.onmessage = (e) => {
		try {
			const msg = JSON.parse(e.data) as
				| { type: 'new-photo'; photoId: string; cfImagesId: string | null; createdAt: number }
				| { type: 'ack' }
			if (msg.type === 'new-photo') {
				photos.value = [
					{ id: msg.photoId, cfImagesId: msg.cfImagesId, createdAt: msg.createdAt },
					...photos.value,
				].slice(0, 100)
			}
		} catch {
			// ignore
		}
	}
	ws.onclose = () => {
		connectionState.value = 'reconnecting'
		reconnectTimer = setTimeout(connect, 2000)
	}
	ws.onerror = () => {
		ws?.close()
	}
}

function imageUrl(cfImagesId: string | null): string {
	if (!cfImagesId) {
		return `data:image/svg+xml,${encodeURIComponent(
			`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='hsl(${Math.floor(Math.random() * 360)},70%,55%)'/></svg>`
		)}`
	}
	return `https://imagedelivery.net/${props.cfImagesHash}/${cfImagesId}/public`
}

const cssVars = computed(() => brandingToCssVars(props.branding))
const gridStyle = computed(() => ({
	gridTemplateColumns: `repeat(var(--wall-cols), minmax(0, 1fr))`,
	gap: `var(--wall-gap)`,
}))

onMounted(() => {
	if (props.live) connect()
})

onBeforeUnmount(() => {
	if (reconnectTimer) clearTimeout(reconnectTimer)
	ws?.close()
})
</script>

<template>
	<div class="photo-wall" :style="cssVars">
		<div v-if="live" class="status-bar">
			<span v-if="connectionState === 'open'">● live</span>
			<span v-else-if="connectionState === 'connecting'">connecting…</span>
			<span v-else>reconnecting…</span>
			<span class="ml-3">{{ photos.length }} photos</span>
		</div>

		<div
			v-if="branding.titleOverlay.enabled && (branding.titleOverlay.line1 || branding.titleOverlay.line2)"
			class="title-overlay"
		>
			<div v-if="branding.titleOverlay.line1" class="title-line1">
				{{ branding.titleOverlay.line1 }}
			</div>
			<div v-if="branding.titleOverlay.line2" class="title-line2">
				{{ branding.titleOverlay.line2 }}
			</div>
		</div>

		<div class="grid p-4" :style="gridStyle">
			<TransitionGroup name="wall-photo">
				<div
					v-for="photo in photos"
					:key="photo.id"
					class="aspect-square overflow-hidden rounded"
				>
					<img
						:src="imageUrl(photo.cfImagesId)"
						alt=""
						class="h-full w-full object-cover"
					/>
				</div>
			</TransitionGroup>
		</div>
	</div>
</template>

<!--
PhotoWall styles live in src/styles/global.css. Component-local <style>
blocks here would be silently dropped from the bundle (client:only Vue +
Tailwind v4 interaction).
-->
