import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Disable a11y warnings for interactive elements
    accessors: false,
  },
  onwarn: (warning, handler) => {
    // Ignore a11y warnings for interactive elements we control
    if (warning.code.startsWith('a11y')) return;
    handler(warning);
  },
}
