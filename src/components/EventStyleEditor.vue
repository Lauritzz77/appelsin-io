<script setup lang="ts">
import { ref, reactive, computed, watch } from "vue";
import PhotoWall from "./PhotoWall.vue";
import {
  DENSITIES,
  DENSITY_IDS,
  FONTS,
  FONT_IDS,
  type EventBranding,
} from "../lib/branding";

type Photo = {
  id: string;
  mediaType: "photo" | "video";
  cfImagesId: string | null;
  cfStreamUid: string | null;
  durationSeconds: number | null;
  createdAt: number;
  uploaderName: string | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
};

const props = defineProps<{
  eventId: string;
  eventCode: string;
  initial: EventBranding;
  previewPhotos: Photo[];
  cfImagesHash: string;
  qrDataUrl: string;
}>();

const branding = reactive<EventBranding>({
  background: props.initial.background,
  text: props.initial.text,
  density: props.initial.density,
  font: props.initial.font,
  titleOverlay: {
    enabled: props.initial.titleOverlay.enabled,
    line1: props.initial.titleOverlay.line1,
    line2: props.initial.titleOverlay.line2,
  },
});

const initialSnapshot = JSON.stringify(props.initial);
const dirty = computed(() => JSON.stringify(branding) !== initialSnapshot);

const saving = ref(false);
const lastSavedSnapshot = ref(initialSnapshot);
const flash = ref<"saved" | "error" | null>(null);
const errorMessage = ref("");

async function save() {
  if (saving.value) return;
  saving.value = true;
  flash.value = null;
  errorMessage.value = "";
  try {
    const res = await fetch(`/api/events/${props.eventId}/style`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(branding),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(payload?.message || `Lagring mislykkedes (${res.status})`);
    }
    lastSavedSnapshot.value = JSON.stringify(branding);
    flash.value = "saved";
    setTimeout(() => {
      if (flash.value === "saved") flash.value = null;
    }, 2000);
  } catch (e) {
    flash.value = "error";
    errorMessage.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

function reset() {
  const initial = JSON.parse(lastSavedSnapshot.value) as EventBranding;
  branding.background = initial.background;
  branding.text = initial.text;
  branding.density = initial.density;
  branding.font = initial.font;
  branding.titleOverlay.enabled = initial.titleOverlay.enabled;
  branding.titleOverlay.line1 = initial.titleOverlay.line1;
  branding.titleOverlay.line2 = initial.titleOverlay.line2;
}

watch(dirty, (isDirty) => {
  if (isDirty) {
    window.addEventListener("beforeunload", beforeUnloadHandler);
  } else {
    window.removeEventListener("beforeunload", beforeUnloadHandler);
  }
});
function beforeUnloadHandler(e: BeforeUnloadEvent) {
  e.preventDefault();
}

// Preview renders the real PhotoWall component inside a 16:9 query
// container, so the cascade is identical to what the venue display shows.
// connectWebsocket={false} keeps the editor from opening a second WS to
// the same DO while the host is tweaking styles.
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-[360px_1fr]">
    <aside class="space-y-6">
      <section class="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 class="mb-3 text-sm font-medium">Farver</h2>
        <div class="space-y-3">
          <label class="flex items-center justify-between gap-3">
            <span class="text-xs text-zinc-400">Baggrund</span>
            <span class="flex items-center gap-2">
              <span class="font-mono text-xs text-zinc-500">{{
                branding.background
              }}</span>
              <input
                v-model="branding.background"
                type="color"
                class="h-8 w-12 cursor-pointer rounded-md border border-zinc-700 bg-transparent p-0.5"
              />
            </span>
          </label>
          <label class="flex items-center justify-between gap-3">
            <span class="text-xs text-zinc-400">Tekst</span>
            <span class="flex items-center gap-2">
              <span class="font-mono text-xs text-zinc-500">{{
                branding.text
              }}</span>
              <input
                v-model="branding.text"
                type="color"
                class="h-8 w-12 cursor-pointer rounded-md border border-zinc-700 bg-transparent p-0.5"
              />
            </span>
          </label>
        </div>
      </section>

      <section class="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 class="mb-3 text-sm font-medium">Skrifttype</h2>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="id in FONT_IDS"
            :key="id"
            type="button"
            class="rounded-lg border p-3 text-center transition"
            :class="
              branding.font === id
                ? 'border-orange-500 bg-orange-500/10'
                : 'border-zinc-800 hover:border-zinc-700'
            "
            @click="branding.font = id"
          >
            <div
              class="text-2xl"
              :style="{
                fontFamily: FONTS[id].family,
                fontWeight: FONTS[id].headlineWeight,
                textTransform: FONTS[id].headlineTransform,
                letterSpacing: FONTS[id].headlineTracking,
              }"
            >
              Aa
            </div>
            <div class="mt-1 text-xs text-zinc-400">{{ FONTS[id].label }}</div>
          </button>
        </div>
      </section>

      <section class="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 class="mb-3 text-sm font-medium">Fliseopdeling</h2>
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
          <span>Titel-overlay</span>
          <input
            type="checkbox"
            v-model="branding.titleOverlay.enabled"
            class="h-4 w-4 accent-orange-500"
          />
        </label>
        <div v-if="branding.titleOverlay.enabled" class="mt-4 space-y-3">
          <div>
            <label class="block text-xs text-zinc-400">Overskrift</label>
            <input
              v-model="branding.titleOverlay.line1"
              type="text"
              maxlength="80"
              placeholder="Anna & Jonas"
              class="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label class="block text-xs text-zinc-400">Underlinje</label>
            <input
              v-model="branding.titleOverlay.line2"
              type="text"
              maxlength="80"
              placeholder="20. maj 2026"
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
          {{ saving ? "Gemmer…" : "Gem" }}
        </button>
        <button
          type="button"
          :disabled="!dirty || saving"
          class="text-sm text-zinc-400 underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
          @click="reset"
        >
          Annullér
        </button>
        <span v-if="flash === 'saved'" class="text-xs text-green-400"
          >Gemt.</span
        >
        <span v-if="flash === 'error'" class="text-xs text-red-400">{{
          errorMessage
        }}</span>
      </div>
    </aside>
    <div>
      <div class="rounded-2xl border border-zinc-800 bg-zinc-950 p-2">
        <div class="mb-2 px-2 text-xs text-zinc-500">
          Forhåndsvisning · live spejling af fotovæggen ·
          <a
            :href="`/display/${eventCode}`"
            target="_blank"
            class="underline hover:text-zinc-300"
            >åbn fuld væg ↗</a
          >
        </div>
        <div class="preview-stage">
          <PhotoWall
            :code="eventCode"
            :initial-photos="previewPhotos"
            :cf-images-hash="cfImagesHash"
            :branding="branding"
            :qr-data-url="qrDataUrl"
            :connect-websocket="false"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-stage {
  aspect-ratio: 16 / 9;
  width: 100%;
  overflow: hidden;
  /* Makes PhotoWall's cqw/cqh measurements size to this box instead of
	   falling back to the viewport. */
  container-type: size;
}
</style>
