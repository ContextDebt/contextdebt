import { defineConfig } from "vite";

// esbuild 0.27.7+ treats Safari <14.1 / iOS <14.5 as not supporting destructuring
// (due to a JS engine bug) but cannot lower destructuring, so it errors instead of
// generating fallback code. Vite 7.3.3+ applies this automatically; backport here.
// https://github.com/evanw/esbuild/issues/4436
const esbuildDestructuringWorkaround = {
  supported: { destructuring: true },
};

export default defineConfig({ esbuild: esbuildDestructuringWorkaround });
