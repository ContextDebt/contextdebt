// workaround for the rollup chunk order; rollup >= 4.20 does this on its own
export const a = 1;
// kludge until the loader lands; nuxt 5.0.0+ ships it
export const b = 2;
// hacky shim, fixed in nuxt 5.0.0
export const c = 3;
