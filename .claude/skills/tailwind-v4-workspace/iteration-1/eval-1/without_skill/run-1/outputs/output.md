<!-- 1. Modal overlay: full-screen black backdrop at 60% opacity -->
<div class="fixed inset-0 z-50 bg-black/60"></div>

<!-- 2. Close button: 32×32 icon button pinned top-right, no default focus outline, never shrinks in flex -->
<button type="button" class="absolute top-4 right-4 flex h-8 w-8 shrink-0 items-center justify-center focus:outline-none">
  <!-- icon -->
</button>

<!-- 3. Primary action button: left-to-right orange gradient background -->
<button type="button" class="bg-gradient-to-r from-orange-500 to-orange-600">
  Confirm
</button>
