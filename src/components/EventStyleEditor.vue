<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import PhotoWall from './PhotoWall.vue'
import {
	THEMES,
	THEME_IDS,
	DENSITIES,
	DENSITY_IDS,
	type EventBranding,
} from '../lib/branding'

type Photo = { id: string; cfImagesId: string | null; createdAt: number }

const props = defineProps<{
	eventId: string
	eventCode: string
	initial: EventBranding
	previewPhotos: Photo[]
	cfImagesHash: string
}>()

// Reactive working copy — every control mutates this and the preview
// re-renders synchronously. Saving sends this object to the API.
const branding = reactive<EventBranding>({
	theme: props.initial.theme,
	density: props.initial.density,
	titleOverlay: {
		enabled: props.initial.titleOverlay.enabled,
		line1: props.initial.titleOverlay.line1,
		line2: props.initial.titleOverlay.line2,
	},
})

const initialSnapshot = JSON.stringify(props.initial)
const dirty = computed(() => JSON.stringify(branding) !== initialSnapshot)

const saving = ref(false)
const lastSavedSnapshot = ref(initialSnapshot)
const flash = ref<'saved' | 'error' | null>(null)
const errorMessage = ref('')

async function save() {
	if (saving.value) return
	saving.value = true
	flash.value = null
	errorMessage.value = ''
	try {
		const res = await fetch(`/api/events/${props.eventId}/style`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(branding),
		})
		if (!res.ok) {
			const payload = (await res.json().catch(() => null)) as
				| { message?: string }
				| null
			throw new Error(payload?.message || `Save failed (${res.status})`)
		}
		lastSavedSnapshot.value = JSON.stringify(branding)
		flash.value = 'saved'
		setTimeout(() => {
			if (flash.value === 'saved') flash.value = null
		}, 2000)
	} catch (e) {
		flash.value = 'error'
		errorMessage.value = (e as Error).message
	} finally {
		saving.value = false
	}
}

function reset() {
	const initial = JSON.parse(lastSavedSnapshot.value) as EventBranding
	branding.theme = initial.theme
	branding.density = initial.density
	branding.titleOverlay.enabled = initial.titleOverlay.enabled
	branding.titleOverlay.line1 = initial.titleOverlay.line1
	branding.titleOverlay.line2 = initial.titleOverlay.line2
}

// Block accidental navigation away from unsaved changes.
watch(dirty, (isDirty) => {
	if (isDirty) {
		window.addEventListener('beforeunload', beforeUnloadHandler)
	} else {
		window.removeEventListener('beforeunload', beforeUnloadHandler)
	}
})
function beforeUnloadHandler(e: BeforeUnloadEvent) {
	e.preventDefault()
}

const previewPhotos = computed(() => props.previewPhotos)
</script>

<template>
	<div class="grid gap-6 lg:grid-cols-[360px_1fr]">
		<aside class="space-y-6">
			<section class="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
				<h2 class="mb-3 text-sm font-medium">Theme</h2>
				<div class="grid grid-cols-3 gap-2">
					<button
						v-for="id in THEME_IDS"
						:key="id"
						type="button"
						class="rounded-lg border p-3 text-left transition"
						:class="
							branding.theme === id
								? 'border-orange-500 bg-orange-500/10'
								: 'border-zinc-800 hover:border-zinc-700'
						"
						@click="branding.theme = id"
					>
						<div class="text-xs font-medium">{{ THEMES[id].label }}</div>
						<div class="mt-2 flex gap-1">
							<span
								v-for="(swatch, i) in THEMES[id].swatches"
								:key="i"
								class="block h-4 w-4 rounded-full border border-black/10"
								:style="{ background: swatch }"
							/>
						</div>
					</button>
				</div>
			</section>

			<section class="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
				<h2 class="mb-3 text-sm font-medium">Tile density</h2>
				<div class="grid grid-cols-3 gap-2">
					<button
						v-for="id in DENSITY_IDS"
						:key="id"
						type="button"
						class="rounded-lg border px-3 py-2 text-sm transition"
						:class="
							branding.density === id
								? 'border-orange-500 bg-orange-500/10 text-orange-300'
								: 'border-zinc-800 text-zinc-300 hover:border-zinc-700'
						"
						@click="branding.density = id"
					>
						{{ DENSITIES[id].label }}
					</button>
				</div>
			</section>

			<section class="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
				<label class="flex items-center justify-between text-sm font-medium">
					<span>Title overlay</span>
					<input
						type="checkbox"
						v-model="branding.titleOverlay.enabled"
						class="h-4 w-4 accent-orange-500"
					/>
				</label>
				<div v-if="branding.titleOverlay.enabled" class="mt-4 space-y-3">
					<div>
						<label class="block text-xs text-zinc-400">Headline</label>
						<input
							v-model="branding.titleOverlay.line1"
							type="text"
							maxlength="80"
							placeholder="Alison & Matt"
							class="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
						/>
					</div>
					<div>
						<label class="block text-xs text-zinc-400">Subline</label>
						<input
							v-model="branding.titleOverlay.line2"
							type="text"
							maxlength="80"
							placeholder="20 May 2026"
							class="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
						/>
					</div>
				</div>
			</section>

			<div class="flex items-center gap-3">
				<button
					type="button"
					:disabled="!dirty || saving"
					class="rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
					@click="save"
				>
					{{ saving ? 'Saving…' : 'Save' }}
				</button>
				<button
					type="button"
					:disabled="!dirty || saving"
					class="text-sm text-zinc-400 underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
					@click="reset"
				>
					Discard
				</button>
				<span v-if="flash === 'saved'" class="text-xs text-green-400">Saved.</span>
				<span v-if="flash === 'error'" class="text-xs text-red-400">{{ errorMessage }}</span>
			</div>
		</aside>

		<div class="rounded-2xl border border-zinc-800 bg-zinc-950 p-2">
			<div class="mb-2 px-2 text-xs text-zinc-500">
				Live preview · updates as you change settings ·
				<a
					:href="`/display/${eventCode}`"
					target="_blank"
					class="underline hover:text-zinc-300"
					>open full wall ↗</a
				>
			</div>
			<div class="aspect-video overflow-hidden rounded-xl">
				<PhotoWall
					:code="eventCode"
					:initial-photos="previewPhotos"
					:cf-images-hash="cfImagesHash"
					:branding="branding"
					:live="false"
				/>
			</div>
		</div>
	</div>
</template>
