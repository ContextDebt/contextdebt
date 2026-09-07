// .mts is TypeScript; the scanner has to read it like .ts, not skip it
export const READY = true;
// TODO: Remove the dual-package shim once the loader lands
const copy = "remove this when done";
export function build(): boolean { return READY && copy.length > 0; }
