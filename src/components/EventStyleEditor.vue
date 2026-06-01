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
const lastSavedSnapshot = ref(initialSnapshot);
// Compare against the last *saved* state, not the original — otherwise the
// page stays "dirty" after a successful save and the beforeunload guard keeps
// warning on navigation.
const dirty = computed(() => JSON.stringify(branding) !== lastSavedSnapshot.value);

const saving = ref(false);
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
  <div class="style-cols">
    <aside class="flex flex-col gap-4">
      <section class="card card--dark">
        <h2 class="m-0 mb-4 text-[15px] font-bold">Farver</h2>
        <div class="flex flex-col gap-[14px]">
          <label class="flex items-center justify-between gap-3">
            <span class="text-[13.5px] text-tx-3">Baggrund</span>
            <span class="flex items-center gap-2.5">
              <span class="font-mono text-[12px] text-tx-4">{{ branding.background }}</span>
              <input v-model="branding.background" type="color" class="color-input" />
            </span>
          </label>
          <label class="flex items-center justify-between gap-3">
            <span class="text-[13.5px] text-tx-3">Tekst</span>
            <span class="flex items-center gap-2.5">
              <span class="font-mono text-[12px] text-tx-4">{{ branding.text }}</span>
              <input v-model="branding.text" type="color" class="color-input" />
            </span>
          </label>
        </div>
      </section>

      <section class="card card--dark">
        <h2 class="m-0 mb-[14px] text-[15px] font-bold">Skrifttype</h2>
        <div class="grid grid-cols-3 gap-[9px]">
          <button
            v-for="id in FONT_IDS"
            :key="id"
            type="button"
            class="opt px-1.5 py-[14px] text-center"
            :class="{ 'opt--sel': branding.font === id }"
            @click="branding.font = id"
          >
            <div
              class="text-[26px]"
              :style="{
                fontFamily: FONTS[id].family,
                fontWeight: FONTS[id].headlineWeight,
                textTransform: FONTS[id].headlineTransform,
                letterSpacing: FONTS[id].headlineTracking,
              }"
            >
              Aa
            </div>
            <div class="mt-1 text-[12px] text-tx-3">{{ FONTS[id].label }}</div>
          </button>
        </div>
      </section>

      <section class="card card--dark">
        <h2 class="m-0 mb-[14px] text-[15px] font-bold">Fliseopdeling</h2>
        <div class="grid grid-cols-3 gap-[9px]">
          <button
            v-for="id in DENSITY_IDS"
            :key="id"
            type="button"
            class="opt px-2 py-2.5 text-sm font-semibold"
            :class="{ 'opt--sel': branding.density === id }"
            @click="branding.density = id"
          >
            {{ DENSITIES[id].label }}
          </button>
        </div>
      </section>

      <section class="card card--dark">
        <div class="flex items-center justify-between">
          <span class="text-[15px] font-bold">Titel-overlay</span>
          <label class="toggle">
            <input type="checkbox" v-model="branding.titleOverlay.enabled" />
            <span class="knob"></span>
          </label>
        </div>
        <div v-if="branding.titleOverlay.enabled" class="mt-4 flex flex-col gap-[14px]">
          <label class="block">
            <span class="field-label">Overskrift</span>
            <input v-model="branding.titleOverlay.line1" type="text" maxlength="80" placeholder="Anna & Jonas" class="field-input" />
          </label>
          <label class="block">
            <span class="field-label">Underlinje</span>
            <input v-model="branding.titleOverlay.line2" type="text" maxlength="80" placeholder="20. maj 2026" class="field-input" />
          </label>
        </div>
      </section>

      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class="btn btn--primary btn--sm" :disabled="!dirty || saving" @click="save">
          {{ saving ? "Gemmer…" : "Gem ændringer" }}
        </button>
        <button type="button" class="btn btn--ghost btn--sm" :disabled="!dirty || saving" @click="reset">Annullér</button>
        <span v-if="flash === 'saved'" class="text-[13px] text-live">Gemt.</span>
        <span v-if="flash === 'error'" class="text-[13px] text-danger">{{ errorMessage }}</span>
      </div>
    </aside>

    <div>
      <div class="mb-3 flex items-center justify-between">
        <span class="text-[13.5px] text-tx-3">Forhåndsvisning · live spejling af fotovæggen</span>
        <a
          :href="`/display/${eventCode}`"
          target="_blank"
          class="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-accent"
          >Åbn fuld væg ↗</a
        >
      </div>
      <div class="preview-card">
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
.preview-card {
  border-radius: var(--r-lg);
  overflow: hidden;
  border: 1px solid var(--line);
  box-shadow: var(--sh-app);
}
.preview-stage {
  aspect-ratio: 16 / 9;
  width: 100%;
  overflow: hidden;
  /* Makes PhotoWall's cqw/cqh measurements size to this box instead of
		   falling back to the viewport. */
  container-type: size;
}
.color-input {
  height: 34px;
  width: 48px;
  cursor: pointer;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: transparent;
  padding: 2px;
}
.opt {
  border-radius: var(--r-md);
  border: 1.5px solid var(--line);
  background: var(--app-deep);
  color: var(--tx);
  cursor: pointer;
  transition: all 0.15s;
}
.opt:hover {
  border-color: var(--tx-4);
}
.opt--sel {
  border-color: var(--accent);
  background: var(--orange-soft);
  color: var(--accent);
}
</style>
