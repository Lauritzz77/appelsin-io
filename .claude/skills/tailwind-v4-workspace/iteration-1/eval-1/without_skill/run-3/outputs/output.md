<!-- 1. Modal overlay: full-screen black backdrop at 60% opacity -->
<div class="fixed inset-0 z-50 bg-black/60"></div>

<!-- 2. Close button: 32×32 icon button pinned top-right, no focus outline, never shrinks in flex row -->
<button type="button" class="absolute top-4 right-4 flex h-8 w-8 shrink-0 items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
  <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
  </svg>
</button>

<!-- 3. Primary action button: left-to-right orange gradient background -->
<button type="button" class="bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-2.5 text-white">
  Continue
</button>
