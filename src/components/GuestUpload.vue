<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import imageCompression from 'browser-image-compression'
import { streamThumbnailUrl } from '../lib/media'

const props = withDefaults(
	defineProps<{
		code: string
		cfImagesHash: string
		locale?: 'en' | 'da'
		allowVideo?: boolean
		streamDomain?: string
	}>(),
	{ locale: 'en', allowVideo: false, streamDomain: 'videodelivery.net' }
)

type Status = 'idle' | 'compressing' | 'uploading' | 'success' | 'error' | 'full' | 'not_open'
type Photo = {
	id: string
	mediaType: 'photo' | 'video'
	cfImagesId: string | null
	cfStreamUid: string | null
	durationSeconds: number | null
	createdAt: number
}
type Identity = { userId: string; token: string; name: string }

const text = computed(() => ({
	en: {
		nameLabel: 'Your name',
		namePlaceholder: 'e.g. Lau',
		emailLabel: 'Your email',
		emailHelp: "We'll email you a link to download all the photos after the event.",
		continue: 'Continue',
		saving: 'Saving...',
		identityNote: 'Your name appears next to your photos. Your email is only used to send you the photos after the event.',
		sharingAs: 'Sharing as',
		differentName: 'Use a different name',
		addPhoto: props.allowVideo ? 'Tap to add a photo or video' : 'Tap to add a photo',
		camera: props.allowVideo ? 'Camera, photo library, or 15s video clip' : 'Camera or photo library',
		preparing: 'Preparing...',
		uploading: 'Uploading...',
		sent: 'Sent!',
		eventFull: 'Event is full',
		notOpen: 'Not open yet',
		tryAgain: 'Tap to try again',
		photos: 'Your photos',
		empty: 'Nothing yet - your uploads will appear here.',
		deletePhotoTitle: 'Delete photo?',
		deletePhotoMessage: 'This removes the photo from your uploads and the event screen.',
		deletePhoto: 'Delete photo',
		nameRequired: 'Type a name first.',
		emailRequired: 'We need your email to send you the photos after the event.',
		nameTaken: 'That name is taken on this event.',
		joinFailed: 'Could not save that name. Try again.',
		unexpected: 'Unexpected response from server.',
		sessionExpired: 'Your session expired - please rejoin.',
		eventLimit: 'This event has reached its upload limit.',
		uploadsOpen: 'Uploads open 24 hours before the event.',
		videoTooLong: 'Video clips can be max 15 seconds.',
		videoUnavailable: 'Video clips are only available on Gold events.',
	},
	da: {
		nameLabel: 'Dit navn',
		namePlaceholder: 'fx Lau',
		emailLabel: 'Din email',
		emailHelp: 'Vi sender dig et link til at downloade alle billederne efter eventet.',
		continue: 'Fortsæt',
		saving: 'Gemmer...',
		identityNote: 'Dit navn vises ved dine billeder. Din email bruges kun til at sende billederne efter eventet.',
		sharingAs: 'Deler som',
		differentName: 'Brug et andet navn',
		addPhoto: props.allowVideo ? 'Tryk for at tilføje billede eller video' : 'Tryk for at tilføje et billede',
		camera: props.allowVideo ? 'Kamera, fotobibliotek eller 15 sek. videoklip' : 'Kamera eller fotobibliotek',
		preparing: 'Forbereder...',
		uploading: 'Uploader...',
		sent: 'Sendt!',
		eventFull: 'Eventet er fyldt',
		notOpen: 'Ikke åbent endnu',
		tryAgain: 'Tryk for at prøve igen',
		photos: 'Dine billeder',
		empty: 'Ingen endnu - dine uploads vises her.',
		deletePhotoTitle: 'Slet billede?',
		deletePhotoMessage: 'Dette fjerner billedet fra dine uploads og eventets skærm.',
		deletePhoto: 'Slet billede',
		nameRequired: 'Skriv et navn først.',
		emailRequired: 'Vi skal bruge din email for at sende dig billederne efter eventet.',
		nameTaken: 'Det navn er allerede taget til dette event.',
		joinFailed: 'Kunne ikke gemme navnet. Prøv igen.',
		unexpected: 'Uventet svar fra serveren.',
		sessionExpired: 'Din session er udløbet - tilmeld dig igen.',
		eventLimit: 'Eventet har nået uploadgrænsen.',
		uploadsOpen: 'Uploads åbner 24 timer før eventet.',
		videoTooLong: 'Videoklip må højst være 15 sekunder.',
		videoUnavailable: 'Videoklip er kun tilgængelige på Gold-events.',
	},
})[props.locale])

// localStorage key — scoped by event short code so the same browser can hold
// separate identities for separate events without collision.
const storageKey = `appelsin.guest.${props.code}`

const identity = ref<Identity | null>(null)
const myPhotos = ref<Photo[]>([])
const loadingPhotos = ref(false)
const deletingPhotoIds = ref<Set<string>>(new Set())
const deleteError = ref('')

// Name-gate state.
const nameInput = ref('')
const emailInput = ref('')
const joining = ref(false)
const joinError = ref('')

// Upload state — only meaningful once `identity` is set.
const status = ref<Status>('idle')
const errorMsg = ref('')
let resetTimer: ReturnType<typeof setTimeout> | null = null

function loadIdentity(): Identity | null {
	if (typeof window === 'undefined') return null
	try {
		const raw = window.localStorage.getItem(storageKey)
		if (!raw) return null
		const parsed = JSON.parse(raw) as Partial<Identity>
		if (
			typeof parsed.userId === 'string' &&
			typeof parsed.token === 'string' &&
			typeof parsed.name === 'string'
		) {
			return parsed as Identity
		}
	} catch {
		// fall through
	}
	return null
}

function persistIdentity(next: Identity) {
	identity.value = next
	try {
		window.localStorage.setItem(storageKey, JSON.stringify(next))
	} catch {
		// localStorage may be unavailable (private mode, quota); the in-memory
		// ref still works for this session.
	}
}

function clearIdentity() {
	identity.value = null
	myPhotos.value = []
	try {
		window.localStorage.removeItem(storageKey)
	} catch {
		// ignore
	}
}

async function refreshMyPhotos() {
	if (!identity.value) return
	loadingPhotos.value = true
	try {
		const res = await fetch('/api/guest/photos', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: props.code,
				userId: identity.value.userId,
				token: identity.value.token,
			}),
		})
		if (res.status === 401) {
			// Stored identity no longer valid (event reset, user deleted).
			clearIdentity()
			return
		}
		if (!res.ok) return
		const payload = (await res.json()) as { name: string; photos: Photo[] }
		myPhotos.value = payload.photos
	} finally {
		loadingPhotos.value = false
	}
}

async function deletePhoto(photo: Photo) {
	if (!identity.value || deletingPhotoIds.value.has(photo.id)) return
	const confirmed = await window.AppDialog.confirm({
		title: text.value.deletePhotoTitle,
		message: text.value.deletePhotoMessage,
		confirmText: text.value.deletePhoto,
		danger: true,
	})
	if (!confirmed) return

	deleteError.value = ''
	deletingPhotoIds.value = new Set([...deletingPhotoIds.value, photo.id])
	try {
		const res = await fetch('/api/guest/photos', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: props.code,
				userId: identity.value.userId,
				token: identity.value.token,
				photoId: photo.id,
			}),
		})
		if (res.status === 401) {
			clearIdentity()
			return
		}
		if (!res.ok) throw new Error(`Couldn't delete photo (${res.status})`)
		myPhotos.value = myPhotos.value.filter((p) => p.id !== photo.id)
	} catch (e) {
		deleteError.value = (e as Error).message
	} finally {
		const next = new Set(deletingPhotoIds.value)
		next.delete(photo.id)
		deletingPhotoIds.value = next
	}
}

async function join() {
	if (joining.value) return
	joinError.value = ''
	const trimmedName = nameInput.value.trim()
	const trimmedEmail = emailInput.value.trim()
	if (!trimmedName) {
		joinError.value = text.value.nameRequired
		return
	}
	if (!trimmedEmail) {
		joinError.value = text.value.emailRequired
		return
	}
	joining.value = true
	try {
		const res = await fetch('/api/guest/join', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code: props.code, name: trimmedName, email: trimmedEmail }),
		})
		const payload = (await res.json().catch(() => null)) as
			| { userId?: string; token?: string; name?: string; error?: string; message?: string }
			| null
		if (!res.ok) {
			joinError.value =
				payload?.message ||
				(res.status === 409
					? text.value.nameTaken
					: text.value.joinFailed)
			return
		}
		if (!payload?.userId || !payload?.token || !payload?.name) {
			joinError.value = text.value.unexpected
			return
		}
		persistIdentity({ userId: payload.userId, token: payload.token, name: payload.name })
		await refreshMyPhotos()
	} catch (e) {
		joinError.value = (e as Error).message
	} finally {
		joining.value = false
	}
}

async function handleFile(file: File) {
	if (!identity.value) return
	if (resetTimer) clearTimeout(resetTimer)
	if (file.type.startsWith('video/')) {
		await handleVideoFile(file)
		return
	}

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
			body: JSON.stringify({
				code: props.code,
				userId: identity.value.userId,
				token: identity.value.token,
			}),
		})
		if (urlRes.status === 401) {
			clearIdentity()
			throw new Error(text.value.sessionExpired)
		}
		if (urlRes.status === 429) {
			const payload = (await urlRes.json().catch(() => null)) as
				| { message?: string }
				| null
			status.value = 'full'
			errorMsg.value = payload?.message || text.value.eventLimit
			return
		}
		if (urlRes.status === 403) {
			const payload = (await urlRes.json().catch(() => null)) as
				| { error?: string; message?: string }
				| null
			if (payload?.error === 'not_open_yet') {
				status.value = 'not_open'
				errorMsg.value = payload?.message || text.value.uploadsOpen
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
			body: JSON.stringify({
				code: props.code,
				cfImagesId: id,
				userId: identity.value.userId,
				token: identity.value.token,
			}),
		})
		if (!confirmRes.ok) throw new Error(`Couldn't confirm (${confirmRes.status})`)
		const confirmPayload = (await confirmRes.json()) as { photoId: string }

		// Optimistically prepend the new photo so the grid updates without a
		// network round-trip. createdAt is approximate (now); the next time
		// the page reloads we'll get the real DB timestamp.
		myPhotos.value = [
			{
				id: confirmPayload.photoId,
				mediaType: 'photo',
				cfImagesId: id,
				cfStreamUid: null,
				durationSeconds: null,
				createdAt: Date.now(),
			},
			...myPhotos.value,
		]
		status.value = 'success'
		resetTimer = setTimeout(() => {
			if (status.value === 'success') status.value = 'idle'
		}, 1800)
	} catch (e) {
		status.value = 'error'
		errorMsg.value = (e as Error).message
	}
}

function readVideoDuration(file: File): Promise<number> {
	return new Promise((resolve, reject) => {
		const video = document.createElement('video')
		const url = URL.createObjectURL(file)
		video.preload = 'metadata'
		video.onloadedmetadata = () => {
			URL.revokeObjectURL(url)
			resolve(video.duration)
		}
		video.onerror = () => {
			URL.revokeObjectURL(url)
			reject(new Error('Could not read video duration.'))
		}
		video.src = url
	})
}

async function handleVideoFile(file: File) {
	if (!identity.value) return
	if (!props.allowVideo) {
		status.value = 'error'
		errorMsg.value = text.value.videoUnavailable
		return
	}

	status.value = 'compressing'
	errorMsg.value = ''

	try {
		const durationSeconds = await readVideoDuration(file)
		if (durationSeconds > 15.5) {
			status.value = 'error'
			errorMsg.value = text.value.videoTooLong
			return
		}

		status.value = 'uploading'
		const urlRes = await fetch('/api/video-upload-url', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: props.code,
				userId: identity.value.userId,
				token: identity.value.token,
			}),
		})
		if (urlRes.status === 401) {
			clearIdentity()
			throw new Error(text.value.sessionExpired)
		}
		if (urlRes.status === 429) {
			const payload = (await urlRes.json().catch(() => null)) as { message?: string } | null
			status.value = 'full'
			errorMsg.value = payload?.message || text.value.eventLimit
			return
		}
		if (urlRes.status === 403) {
			const payload = (await urlRes.json().catch(() => null)) as
				| { error?: string; message?: string }
				| null
			if (payload?.error === 'not_open_yet') {
				status.value = 'not_open'
				errorMsg.value = payload?.message || text.value.uploadsOpen
				return
			}
			throw new Error(payload?.message || text.value.videoUnavailable)
		}
		if (!urlRes.ok) throw new Error(`Couldn't start video upload (${urlRes.status})`)
		const { uid, uploadURL } = (await urlRes.json()) as { uid: string; uploadURL: string }

		const form = new FormData()
		form.append('file', file, file.name || 'clip.mp4')
		const uploadRes = await fetch(uploadURL, { method: 'POST', body: form })
		if (!uploadRes.ok) throw new Error(`Video upload failed (${uploadRes.status})`)

		const confirmRes = await fetch('/api/video-uploaded', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: props.code,
				cfStreamUid: uid,
				durationSeconds,
				userId: identity.value.userId,
				token: identity.value.token,
			}),
		})
		if (!confirmRes.ok) throw new Error(`Couldn't confirm video (${confirmRes.status})`)
		const confirmPayload = (await confirmRes.json()) as { photoId: string }

		myPhotos.value = [
			{
				id: confirmPayload.photoId,
				mediaType: 'video',
				cfImagesId: null,
				cfStreamUid: uid,
				durationSeconds: Math.ceil(durationSeconds),
				createdAt: Date.now(),
			},
			...myPhotos.value,
		]
		status.value = 'success'
		resetTimer = setTimeout(() => {
			if (status.value === 'success') status.value = 'idle'
		}, 1800)
	} catch (e) {
		status.value = 'error'
		errorMsg.value = (e as Error).message
	}
}

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
		? text.value.addPhoto
		: s === 'compressing'
			? text.value.preparing
			: s === 'uploading'
				? text.value.uploading
				: s === 'success'
					? `✓ ${text.value.sent}`
					: s === 'full'
						? text.value.eventFull
						: s === 'not_open'
							? text.value.notOpen
							: text.value.tryAgain

const busy = (s: Status) => s === 'compressing' || s === 'uploading'
const isDeleting = (photoId: string) => deletingPhotoIds.value.has(photoId)

const photoUrl = (cfImagesId: string | null) =>
	cfImagesId ? `https://imagedelivery.net/${props.cfImagesHash}/${cfImagesId}/public` : ''

const mediaPreviewUrl = (photo: Photo) =>
	photo.mediaType === 'video' && photo.cfStreamUid
		? streamThumbnailUrl(photo.cfStreamUid, props.streamDomain)
		: photoUrl(photo.cfImagesId)

const hasIdentity = computed(() => identity.value !== null)

onMounted(() => {
	const existing = loadIdentity()
	if (existing) {
		identity.value = existing
		refreshMyPhotos()
	}
})
</script>

<template>
	<!-- Name + email gate. Shown until the guest claims a per-event display name. -->
	<form v-if="!hasIdentity" class="space-y-4" @submit.prevent="join">
		<label class="block">
			<span class="mb-2 block text-sm font-medium">{{ text.nameLabel }}</span>
			<input
				v-model="nameInput"
				type="text"
				name="name"
				maxlength="32"
				:placeholder="text.namePlaceholder"
				autocomplete="nickname"
				autocapitalize="words"
				class="w-full rounded-md border border-zinc-700 bg-zinc-950 px-4 py-3 text-base focus:border-orange-500 focus:outline-none"
				:disabled="joining"
			/>
		</label>
		<label class="block">
			<span class="mb-2 block text-sm font-medium">{{ text.emailLabel }}</span>
			<input
				v-model="emailInput"
				type="email"
				name="email"
				inputmode="email"
				maxlength="254"
				placeholder="you@example.com"
				autocomplete="email"
				autocapitalize="off"
				autocorrect="off"
				spellcheck="false"
				class="w-full rounded-md border border-zinc-700 bg-zinc-950 px-4 py-3 text-base focus:border-orange-500 focus:outline-none"
				:disabled="joining"
			/>
			<span class="mt-1 block text-xs text-zinc-500">
				{{ text.emailHelp }}
			</span>
		</label>
		<button
			type="submit"
			class="w-full rounded-md bg-orange-500 px-4 py-3 text-base font-medium text-zinc-950 transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
			:disabled="joining || !nameInput.trim() || !emailInput.trim()"
		>
			{{ joining ? text.saving : text.continue }}
		</button>
		<p v-if="joinError" class="text-sm text-red-400">{{ joinError }}</p>
		<p class="text-xs text-zinc-500">
			{{ text.identityNote }}
		</p>
	</form>

	<!-- Upload + grid. Shown once the guest has a stored identity. -->
	<div v-else class="space-y-6">
		<div class="flex items-center justify-between">
			<p class="text-sm text-zinc-400">
				{{ text.sharingAs }} <span class="font-medium text-zinc-100">{{ identity!.name }}</span>
			</p>
			<button
				type="button"
				class="text-xs text-zinc-500 underline hover:text-zinc-300"
				@click="clearIdentity"
			>
				{{ text.differentName }}
			</button>
		</div>

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
				:accept="props.allowVideo ? 'image/*,video/*' : 'image/*'"
				multiple
				class="hidden"
				@change="onFileChange"
			/>
			<svg
				class="mb-3 h-12 w-14 text-orange-500"
				viewBox="0 0 84 69"
				fill="currentColor"
				xmlns="http://www.w3.org/2000/svg"
				aria-hidden="true"
			>
				<path
					d="M24.9375 39.375C24.9375 43.9003 26.7352 48.2402 29.935 51.44C33.1348 54.6398 37.4747 56.4375 42 56.4375C46.5253 56.4375 50.8652 54.6398 54.065 51.44C57.2648 48.2402 59.0625 43.9003 59.0625 39.375C59.0625 34.8497 57.2648 30.5098 54.065 27.31C50.8652 24.1102 46.5253 22.3125 42 22.3125C37.4747 22.3125 33.1348 24.1102 29.935 27.31C26.7352 30.5098 24.9375 34.8497 24.9375 39.375ZM78.75 10.5H60.375C59.0625 5.25 57.75 0 52.5 0H31.5C26.25 0 24.9375 5.25 23.625 10.5H5.25C2.3625 10.5 0 12.8625 0 15.75V63C0 65.8875 2.3625 68.25 5.25 68.25H78.75C81.6375 68.25 84 65.8875 84 63V15.75C84 12.8625 81.6375 10.5 78.75 10.5ZM42 62.6719C29.1322 62.6719 18.7031 52.2427 18.7031 39.375C18.7031 26.5072 29.1322 16.0781 42 16.0781C54.8677 16.0781 65.2969 26.5072 65.2969 39.375C65.2969 52.2427 54.8677 62.6719 42 62.6719ZM78.75 26.25H68.25V21H78.75V26.25Z"
				/>
			</svg>
			<span class="text-lg font-medium">{{ labelText(status) }}</span>
			<span v-if="status === 'idle'" class="mt-1 text-sm text-zinc-500">
				{{ text.camera }}
			</span>
			<span v-if="status === 'error'" class="mt-1 text-sm text-red-400">{{ errorMsg }}</span>
			<span v-if="status === 'full'" class="mt-1 text-sm text-zinc-400">{{ errorMsg }}</span>
			<span v-if="status === 'not_open'" class="mt-1 text-sm text-zinc-400">{{ errorMsg }}</span>
		</label>

		<section>
			<h2 class="mb-3 text-sm font-medium text-zinc-300">
				{{ text.photos }}
				<span v-if="myPhotos.length > 0" class="ml-1 text-zinc-500">({{ myPhotos.length }})</span>
			</h2>
			<div v-if="myPhotos.length === 0 && !loadingPhotos" class="text-sm text-zinc-500">
				{{ text.empty }}
			</div>
			<div v-else class="grid grid-cols-3 gap-2">
				<div
					v-for="photo in myPhotos"
					:key="photo.id"
					class="group relative aspect-square overflow-hidden rounded-md bg-zinc-900"
				>
					<a
						:href="photo.mediaType === 'video' && photo.cfStreamUid ? `https://iframe.videodelivery.net/${photo.cfStreamUid}` : photoUrl(photo.cfImagesId)"
						target="_blank"
						rel="noopener"
						class="block h-full w-full"
					>
						<img
							v-if="mediaPreviewUrl(photo)"
							:src="mediaPreviewUrl(photo)"
							alt=""
							loading="lazy"
							class="h-full w-full object-cover transition group-hover:scale-105"
							:class="{ 'opacity-45': isDeleting(photo.id) }"
						/>
						<span
							v-if="photo.mediaType === 'video'"
							class="absolute bottom-1 left-1 rounded bg-zinc-950/80 px-1.5 py-0.5 text-[10px] font-medium text-white"
						>
							{{ photo.durationSeconds ? `${photo.durationSeconds}s` : 'Video' }}
						</span>
					</a>
					<button
						type="button"
						class="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-zinc-950/80 text-white shadow-sm ring-1 ring-white/20 transition hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:cursor-wait disabled:opacity-60"
						:disabled="isDeleting(photo.id)"
						:aria-label="text.deletePhoto"
						:title="text.deletePhoto"
						@click="deletePhoto(photo)"
					>
						<svg
							class="h-4 w-4"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M3 6h18" />
							<path d="M8 6V4h8v2" />
							<path d="M19 6l-1 14H6L5 6" />
							<path d="M10 11v5" />
							<path d="M14 11v5" />
						</svg>
					</button>
				</div>
			</div>
			<p v-if="deleteError" class="mt-3 text-sm text-red-400">{{ deleteError }}</p>
		</section>
	</div>
</template>
