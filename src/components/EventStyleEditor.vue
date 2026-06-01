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
  <div class="style-cols">
    <aside style="display: flex; flex-direction: column; gap: 16px">
      <section class="card card--dark" style="padding: 22px">
        <h2 style="font-size: 15px; font-weight: 700; margin: 0 0 16px">Farver</h2>
        <div style="display: flex; flex-direction: column; gap: 14px">
          <label style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
            <span style="font-size: 13.5px; color: var(--tx-3)">Baggrund</span>
            <span style="display: flex; align-items: center; gap: 10px">
              <span style="font-family: var(--mono); font-size: 12px; color: var(--tx-4)">{{ branding.background }}</span>
              <input v-model="branding.background" type="color" class="color-input" />
            </span>
          </label>
          <label style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
            <span style="font-size: 13.5px; color: var(--tx-3)">Tekst</span>
            <span style="display: flex; align-items: center; gap: 10px">
              <span style="font-family: var(--mono); font-size: 12px; color: var(--tx-4)">{{ branding.text }}</span>
              <input v-model="branding.text" type="color" class="color-input" />
            </span>
          </label>
        </div>
      </section>

      <section class="card card--dark" style="padding: 22px">
        <h2 style="font-size: 15px; font-weight: 700; margin: 0 0 14px">Skrifttype</h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 9px">
          <button
            v-for="id in FONT_IDS"
            :key="id"
            type="button"
            class="opt"
            :class="{ 'opt--sel': branding.font === id }"
            style="padding: 14px 6px; text-align: center"
            @click="branding.font = id"
          >
            <div
              style="font-size: 26px"
              :style="{
                fontFamily: FONTS[id].family,
                fontWeight: FONTS[id].headlineWeight,
                textTransform: FONTS[id].headlineTransform,
                letterSpacing: FONTS[id].headlineTracking,
              }"
            >
              Aa
            </div>
            <div style="margin-top: 4px; font-size: 12px; color: var(--tx-3)">{{ FONTS[id].label }}</div>
          </button>
        </div>
      </section>

      <section class="card card--dark" style="padding: 22px">
        <h2 style="font-size: 15px; font-weight: 700; margin: 0 0 14px">Fliseopdeling</h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 9px">
          <button
            v-for="id in DENSITY_IDS"
            :key="id"
            type="button"
            class="opt"
            :class="{ 'opt--sel': branding.density === id }"
            style="padding: 10px 8px; font-size: 14px; font-weight: 600"
            @click="branding.density = id"
          >
            {{ DENSITIES[id].label }}
          </button>
        </div>
      </section>

      <section class="card card--dark" style="padding: 22px">
        <div style="display: flex; align-items: center; justify-content: space-between">
          <span style="font-size: 15px; font-weight: 700">Titel-overlay</span>
          <label class="toggle">
            <input type="checkbox" v-model="branding.titleOverlay.enabled" />
            <span class="knob"></span>
          </label>
        </div>
        <div v-if="branding.titleOverlay.enabled" style="margin-top: 16px; display: flex; flex-direction: column; gap: 14px">
          <label style="display: block">
            <span class="field-label">Overskrift</span>
            <input v-model="branding.titleOverlay.line1" type="text" maxlength="80" placeholder="Anna & Jonas" class="field-input" />
          </label>
          <label style="display: block">
            <span class="field-label">Underlinje</span>
            <input v-model="branding.titleOverlay.line2" type="text" maxlength="80" placeholder="20. maj 2026" class="field-input" />
          </label>
        </div>
      </section>

      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
        <button type="button" class="btn btn--primary btn--sm" :disabled="!dirty || saving" @click="save">
          {{ saving ? "Gemmer…" : "Gem ændringer" }}
        </button>
        <button type="button" class="btn btn--ghost btn--sm" :disabled="!dirty || saving" @click="reset">Annullér</button>
        <span v-if="flash === 'saved'" style="font-size: 13px; color: var(--live)">Gemt.</span>
        <span v-if="flash === 'error'" style="font-size: 13px; color: #ff8499">{{ errorMessage }}</span>
      </div>
    </aside>

    <div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px">
        <span style="font-size: 13.5px; color: var(--tx-3)">Forhåndsvisning · live spejling af fotovæggen</span>
        <a
          :href="`/display/${eventCode}`"
          target="_blank"
          style="display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; color: var(--accent); font-weight: 600"
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
