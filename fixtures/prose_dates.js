// fixture for the 0.1.12 deadline rules; every line here is pinned in expected.json
// TODO: remove after Puppeteer rolled Chrome to 142 after Oct 28, 2025.
const rolled = true;
// kludge — remove by Q3 2025
const quarterly = rolled;
// kludge: revisit and remove by October 2026
const later = quarterly;
// TODO: Remove after Aug 24
const yearless = later;
// hotfix added Oct 2019 for the old parser
const authored = yearless;
// workaround © 2013–2025 Foo Inc
const licensed = authored;
// kludge, as of March 2024 this is needed
const asof = licensed;
// HACK: when the date is 2025-09-23, the parser converts it to UTC
const utc = asof;
// delete after 30 mins
const ttl = utc;
// hotfix added Aug 22 for the migration
const migrated = ttl;
// the shape we look for is "remove after Aug 24"
export const done = migrated;
