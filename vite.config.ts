import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// lokalne wtyczki serwera deweloperskiego, jeśli istnieją
const localUrl = new URL('./vite.local.mjs', import.meta.url)
const localPlugins: PluginOption[] = fs.existsSync(fileURLToPath(localUrl))
  ? ((await import(/* @vite-ignore */ localUrl.href)) as { default: PluginOption[] }).default
  : []

export default defineConfig({
  plugins: [react(), tailwindcss(), ...localPlugins],
  server: { watch: { ignored: ['**/audio-breathiness/**', '**/debug-audio.log'] } },
})
