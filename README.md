
# Due Dates

Due Dates is a lightweight Firefox WebExtension that scrapes assignment and assessment deadlines from Gradescope and PrairieLearn and shows them in a compact popup. Deadlines are stored locally and presented in a simple upcoming list with optional desktop notifications.

Key goals: privacy-first (no external servers), minimal permissions, and reliable scraping for supported course sites.

## Features

- Scrapes deadlines from Gradescope and PrairieLearn
- Aggregates, deduplicates, and stores deadlines in `browser.storage.local`
- Popup UI with Upcoming and Done views
- Mark items as Done (with undo) and export/clear stored data
- Desktop notifications and badge counter for soon-due items

## Quick install (development)

1. Ensure the required icon PNGs exist in `icons/`: `icon16.png`, `icon48.png`, `icon128.png` (see `icons/README.md`).
2. In Firefox open `about:debugging` → `This Firefox` → `Load Temporary Add-on` and select this directory's `manifest.json`.

For publishing you'll build a signed `.xpi` (see Development → Packaging).

## Usage

- Click the extension icon to open the popup and view upcoming deadlines.
- Visit a supported assignment page and allow the extension to scrape it automatically, or click the refresh button in the popup to force a scrape of the active page.
- Open Options from the popup to configure notification timing and manage stored data.

## Supported sites

- Gradescope (`*.gradescope.com`) — assignment pages
- PrairieLearn (`*.prairielearn.com`) — assessments pages

## Development

Requirements:

- Node.js and npm (for optional dev tooling)

Typical workflow:

1. Install dev deps (if any): `npm install`
2. Lint: `npm run lint` (if configured)
3. Build a distributable XPI: `npm i -g web-ext` then `web-ext build`

The built `.xpi` will appear in `web-ext-artifacts/`.

Load the `.xpi` in Firefox for more realistic testing, or use `about:debugging` and load `manifest.json` for rapid iteration.

## Packaging and publishing tips

- Use `web-ext build` to create a package ready for signing.
- For AMO (addons.mozilla.org) submission, create a developer account and upload the generated `.xpi` in the Developer Hub.
- Consider adding a GitHub Actions workflow to run `web-ext build` on tags and attach artifacts to Releases.

## File layout

```
due-dates/
├── manifest.json
├── background.js
├── content-scripts/
│   ├── scrape-gradescope.js
│   └── scrape-prairielearn.js
├── lib/
│   └── date-parser.js
├── ui/
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   ├── options.html
│   └── options.js
├── icons/
│   ├── icon-template.svg
│   └── README.md
├── LICENSE
└── README.md
```

## Data model

Each deadline is stored as an object like:

```json
{
  "id": "unique-id",
  "title": "Assignment name",
  "dueDate": "2025-10-15T23:59:00.000Z",
  "course": "Course name",
  "link": "https://...",
  "source": "Gradescope"
}
```

## Privacy

This extension stores data locally and does not contact external servers. It requires the following permissions: `storage`, `scripting`, `activeTab`, `notifications`, and `alarms` so it can read pages during scraping, persist results, and schedule notifications.

If your workflow requires a privacy policy (AMO may request it when you ask for sensitive permissions), you can host a short policy as a GitHub Pages page and link to it from the AMO listing.

## Contributing

Contributions are welcome. Please:

- Open an issue to discuss significant changes or add a feature request
- Send a PR with a descriptive title and tests for new scrapers when possible

## License

This project should include a `LICENSE` file. A permissive choice is the MIT license.

---

If you want, I can also:

- Add this README to the repository now
- Create a `.gitignore` and an MIT `LICENSE` file
- Inspect `manifest.json` and suggest concrete changes for publishing

Let me know which of these to do next.