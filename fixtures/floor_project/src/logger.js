// The vitest line, with the issue link written as owner/repo#N rather than a full
// github.com URL: a URL here would make every test run reach for the API.
// workaround for vitejs/vite#15438, it was fixed in vite 5.1
export const fallbackUrl = "http://localhost";
