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

// Big tap-to-capture button styling, driven by upload status.
const captureStyle = computed(() => {
	const base: Record<string, string> = {
		width: '100%',
		borderRadius: 'var(--r-2xl)',
		padding: '40px 24px',
		cursor: 'pointer',
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: '14px',
		border: '1px solid rgba(255,255,255,.2)',
		transition: 'all .2s',
		background: 'var(--accent)',
		color: '#2C1700',
		boxShadow: '0 18px 50px rgba(255,162,41,.4)',
		textAlign: 'center',
	}
	const s = status.value
	if (s === 'success')
		return { ...base, background: 'var(--live)', color: '#04321f', boxShadow: '0 18px 50px rgba(52,211,153,.4)' }
	if (s === 'error')
		return { ...base, background: 'rgba(244,63,94,.14)', color: '#ff8499', border: '1px solid rgba(244,63,94,.32)', boxShadow: 'none' }
	if (s === 'full' || s === 'not_open')
		return { ...base, background: 'var(--s2)', color: 'var(--tx-2)', border: '1px solid var(--line)', boxShadow: 'none', cursor: 'default' }
	if (s === 'compressing' || s === 'uploading') return { ...base, opacity: '0.85', pointerEvents: 'none' }
	return base
})
const iconBg = computed(() =>
	status.value === 'full' || status.value === 'not_open' ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.35)'
)

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
	<div v-if="!hasIdentity" class="card card--dark" style="padding: 26px">
		<form style="display: flex; flex-direction: column; gap: 18px" @submit.prevent="join">
			<label style="display: block">
				<span class="field-label">{{ text.nameLabel }}</span>
				<input
					v-model="nameInput"
					type="text"
					name="name"
					maxlength="32"
					:placeholder="text.namePlaceholder"
					autocomplete="nickname"
					autocapitalize="words"
					class="field-input"
					:disabled="joining"
				/>
			</label>
			<label style="display: block">
				<span class="field-label">{{ text.emailLabel }}</span>
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
					class="field-input"
					:disabled="joining"
				/>
				<span style="margin-top: 8px; display: block; font-size: 12.5px; color: var(--tx-3)">
					{{ text.emailHelp }}
				</span>
			</label>
			<button
				type="submit"
				class="btn btn--primary btn--full btn--lg"
				:disabled="joining || !nameInput.trim() || !emailInput.trim()"
			>
				{{ joining ? text.saving : text.continue }}
			</button>
			<p v-if="joinError" style="font-size: 14px; color: #ff8499">{{ joinError }}</p>
			<p style="font-size: 12.5px; line-height: 1.5; color: var(--tx-3)">
				{{ text.identityNote }}
			</p>
		</form>
	</div>

	<!-- Upload + grid. Shown once the guest has a stored identity. -->
	<div v-else>
		<!-- Giant tap-to-capture target -->
		<label :style="captureStyle">
			<input
				type="file"
				:accept="props.allowVideo ? 'image/*,video/*' : 'image/*'"
				multiple
				style="display: none"
				@change="onFileChange"
			/>
			<span
				:style="{
					width: '78px',
					height: '78px',
					borderRadius: '999px',
					background: iconBg,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
				}"
			>
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
					<circle cx="12" cy="13" r="4" />
				</svg>
			</span>
			<span style="font-size: 21px; font-weight: 800">{{ labelText(status) }}</span>
			<span v-if="status === 'idle'" style="font-size: 13.5px; font-weight: 600; opacity: 0.72">
				{{ text.camera }}
			</span>
			<span v-if="status === 'error'" style="font-size: 13px; margin-top: 2px">{{ errorMsg }}</span>
			<span v-if="status === 'full' || status === 'not_open'" style="font-size: 13px; margin-top: 2px">{{ errorMsg }}</span>
		</label>

		<!-- Sharing as -->
		<div style="padding: 18px 0 0; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 14.5px; flex-wrap: wrap">
			<span style="color: var(--tx-3)">{{ text.sharingAs }}</span>
			<span style="font-family: var(--hand); font-size: 22px; color: var(--orange); font-weight: 700">{{ identity!.name }}</span>
			<button
				type="button"
				style="color: var(--tx-2); font-size: 13.5px; font-weight: 600; text-decoration: underline; text-underline-offset: 3px"
				@click="clearIdentity"
			>
				{{ text.differentName }}
			</button>
		</div>

		<!-- Your uploads -->
		<section style="padding: 26px 0 8px">
			<div style="font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tx-3); margin-bottom: 14px">
				{{ text.photos }}<span v-if="myPhotos.length > 0"> ({{ myPhotos.length }})</span>
			</div>
			<div v-if="myPhotos.length === 0 && !loadingPhotos" style="font-size: 14px; color: var(--tx-3)">
				{{ text.empty }}
			</div>
			<div v-else style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 9px">
				<div
					v-for="(photo, idx) in myPhotos"
					:key="photo.id"
					class="guest-tile"
					style="position: relative; aspect-ratio: 1; border-radius: var(--r-md); overflow: hidden; border: 1px solid var(--line)"
				>
					<a
						:href="photo.mediaType === 'video' && photo.cfStreamUid ? `https://iframe.videodelivery.net/${photo.cfStreamUid}` : photoUrl(photo.cfImagesId)"
						target="_blank"
						rel="noopener"
						style="display: block; height: 100%; width: 100%"
					>
						<img
							v-if="mediaPreviewUrl(photo)"
							:src="mediaPreviewUrl(photo)"
							alt=""
							loading="lazy"
							style="height: 100%; width: 100%; object-fit: cover; display: block"
							:style="{ opacity: isDeleting(photo.id) ? 0.45 : 1 }"
						/>
						<span
							v-if="photo.mediaType === 'video'"
							style="position: absolute; bottom: 6px; left: 6px; border-radius: 6px; background: rgba(0,0,0,.6); color: #fff; padding: 2px 6px; font-size: 10.5px; font-weight: 700"
						>
							{{ photo.durationSeconds ? `${photo.durationSeconds}s` : 'Video' }}
						</span>
					</a>
					<span
						v-if="idx === 0"
						style="position: absolute; left: 6px; top: 6px; padding: 2px 7px; border-radius: 6px; background: var(--accent); color: #2C1700; font-size: 10.5px; font-weight: 800"
					>
						{{ props.locale === 'da' ? 'ny' : 'new' }}
					</span>
					<button
						type="button"
						class="guest-del"
						:disabled="isDeleting(photo.id)"
						:aria-label="text.deletePhoto"
						:title="text.deletePhoto"
						@click="deletePhoto(photo)"
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M3 6h18" />
							<path d="M8 6V4h8v2" />
							<path d="M19 6l-1 14H6L5 6" />
							<path d="M10 11v5" />
							<path d="M14 11v5" />
						</svg>
					</button>
				</div>
			</div>
			<p v-if="deleteError" style="margin-top: 14px; font-size: 14px; color: #ff8499">{{ deleteError }}</p>
			<p style="font-size: 12.5px; color: var(--tx-4); text-align: center; margin-top: 22px; line-height: 1.5">
				{{ props.locale === 'da'
					? 'Billederne gemmes hos værten og slettes efter eventet.'
					: 'Photos are stored by the host and deleted after the event.' }}
			</p>
		</section>
	</div>
</template>

<style scoped>
.guest-del {
	position: absolute;
	right: 6px;
	top: 6px;
	width: 28px;
	height: 28px;
	border-radius: 999px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(4, 10, 30, 0.62);
	color: #fff;
	opacity: 0;
	transition: opacity 0.15s, background 0.15s;
	cursor: pointer;
}
.guest-tile:hover .guest-del,
.guest-del:focus {
	opacity: 1;
}
.guest-del:hover {
	background: rgba(244, 63, 94, 0.92);
}
.guest-del:disabled {
	cursor: wait;
	opacity: 0.6;
}
</style>
