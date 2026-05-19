<script setup lang="ts">
import { ref } from 'vue'
import imageCompression from 'browser-image-compression'

const props = defineProps<{ code: string }>()

type Status = 'idle' | 'compressing' | 'uploading' | 'success' | 'error' | 'full' | 'not_open'

const status = ref<Status>('idle')
const errorMsg = ref('')
const uploadedCount = ref(0)
let resetTimer: ReturnType<typeof setTimeout> | null = null

async function handleFile(file: File) {
	if (resetTimer) clearTimeout(resetTimer)
	status.value = 'compressing'
	errorMsg.value = ''

	try {
		const compressed = await imageCompression(file, {
			maxSizeMB: 1,
			maxWidthOrHeight: 2000,
			useWebWorker: true,
		})

		status.value = 'uploading'

		const urlRes = await fetch('/api/upload-url', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code: props.code }),
		})
		if (urlRes.status === 429) {
			const payload = (await urlRes.json().catch(() => null)) as
				| { message?: string }
				| null
			status.value = 'full'
			errorMsg.value = payload?.message || 'This event has reached its photo limit.'
			return
		}
		if (urlRes.status === 403) {
			const payload = (await urlRes.json().catch(() => null)) as
				| { error?: string; message?: string }
				| null
			if (payload?.error === 'not_open_yet') {
				status.value = 'not_open'
				errorMsg.value = payload?.message || 'Uploads open 24 hours before the event.'
				return
			}
		}
		if (!urlRes.ok) throw new Error(`Couldn't start upload (${urlRes.status})`)
		const { id, uploadURL } = (await urlRes.json()) as { id: string; uploadURL: string }

		const form = new FormData()
		form.append('file', compressed, file.name || 'photo.jpg')
		const uploadRes = await fetch(uploadURL, { method: 'POST', body: form })
		if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status})`)

		const confirmRes = await fetch('/api/photo-uploaded', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code: props.code, cfImagesId: id }),
		})
		if (!confirmRes.ok) throw new Error(`Couldn't confirm (${confirmRes.status})`)

		uploadedCount.value++
		status.value = 'success'
		resetTimer = setTimeout(() => {
			if (status.value === 'success') status.value = 'idle'
		}, 1800)
	} catch (e) {
		status.value = 'error'
		errorMsg.value = (e as Error).message
	}
}

// TEMPORARY: multi-file upload to make testing easier. Sequential so the
// per-upload cap check + CF Images rate limits behave predictably; stops the
// batch as soon as the event fills up.
async function onFileChange(e: Event) {
	const input = e.target as HTMLInputElement
	const files = Array.from(input.files ?? [])
	input.value = ''
	for (const file of files) {
		await handleFile(file)
		if (status.value === 'full' || status.value === 'not_open') break
	}
}

const labelText = (s: Status) =>
	s === 'idle'
		? 'Tap to add a photo'
		: s === 'compressing'
			? 'Preparing…'
			: s === 'uploading'
				? 'Uploading…'
				: s === 'success'
					? '✓ Sent!'
					: s === 'full'
						? 'Event is full'
						: s === 'not_open'
							? 'Not open yet'
							: 'Tap to try again'

const busy = (s: Status) => s === 'compressing' || s === 'uploading'
</script>

<template>
	<div class="space-y-4">
		<label
			class="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-900/50 p-10 text-center transition active:bg-zinc-900"
			:class="{
				'pointer-events-none opacity-60':
					busy(status) || status === 'full' || status === 'not_open',
				'border-green-600 bg-green-950/30': status === 'success',
				'border-red-600 bg-red-950/30': status === 'error',
				'border-zinc-700 bg-zinc-900/30': status === 'full' || status === 'not_open',
			}"
		>
			<input
				type="file"
				accept="image/*"
				multiple
				class="hidden"
				@change="onFileChange"
			/>
			<svg
				class="mb-3 h-10 w-10 text-orange-500"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				aria-hidden="true"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
				/>
			</svg>
			<span class="text-lg font-medium">{{ labelText(status) }}</span>
			<span v-if="status === 'idle'" class="mt-1 text-sm text-zinc-500">
				Camera or photo library
			</span>
			<span v-if="status === 'error'" class="mt-1 text-sm text-red-400">{{ errorMsg }}</span>
			<span v-if="status === 'full'" class="mt-1 text-sm text-zinc-400">{{ errorMsg }}</span>
			<span v-if="status === 'not_open'" class="mt-1 text-sm text-zinc-400">{{ errorMsg }}</span>
		</label>

		<p v-if="uploadedCount > 0" class="text-center text-xs text-zinc-500">
			You've shared {{ uploadedCount }} photo{{ uploadedCount === 1 ? '' : 's' }}.
		</p>
	</div>
</template>
