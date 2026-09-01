var kludge = 0;
// workaround until we upgrade
const s = "remove this when done";
/* HACK: remove after 2025-01-01 */
const u = "https://example.com/kludge";
const msg = "This is a hacky solution, sorry";
var kludge2 = 0; // workaround until we upgrade
// cannot remove this until the vendor ships
function hotfixQueue() { return kludge; }
/*
   workaround for the broken types
   remove this when the parser lands
*/
const label = "We will delete this when the sale ends";
// A date alone proves nothing: "# 2014-12-02 Add workaround" is an authored date
// rejected match matters: `var kludge = 0; // workaround until we upgrade` is a
// Workaround for the "flush on exit" bug in upstream
// "workaround until X" is the shape we look for
