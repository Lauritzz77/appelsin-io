// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  adapter: cloudflare(),
  devToolbar: {
    enabled: false
  },
  integrations: [vue()],
  i18n: {
    locales: ['da', 'en'],
    defaultLocale: 'da',
    routing: {
      prefixDefaultLocale: false
    }
  },

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@cms': fileURLToPath(new URL('./cms', import.meta.url)),
        '@lib': fileURLToPath(new URL('./src/lib', import.meta.url))
      }
    }
  }
});
