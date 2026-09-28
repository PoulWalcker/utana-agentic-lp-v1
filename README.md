# Utana Agentic Technologies

Responsive static website for Utana, with a navy and silver design, automation use cases, articles, team profiles, and a pilot enquiry form.

## Run locally

From this directory:

```sh
python3 -m http.server 8766
```

Open http://localhost:8766. No build step or package installation is required.

## Website files

- `index.html`: main landing page
- `styles.css` and `navy.css`: shared layout, responsive styles, and colours
- `site.js`: navigation, decorative motion, and enquiry form behaviour
- `use-cases.html`, `use-cases/`, and `use-cases.css`: automation workflow library
- `blog/`: articles linked from the homepage
- `assets/team/`: team portraits
- `privacy.html`: privacy information
- `preview-*.html`, `navy.html`, and `blog-navy/`: design variants and alternate pages

## Deploy

Serve this directory from any static web host, with `index.html` at the site root. Include the CSS, JavaScript, articles, use-case pages, and assets. Preview pages are optional for deployment.

## Contact form

The form validates the required contact name, business name, phone, email, and workflow description, then opens an email draft addressed to `info@utana.agentic.technologies`. The visitor must send the draft from their email application. There is no submission backend or database.

Google Fonts are loaded remotely with system-font fallbacks. Workflow articles describe proposed implementations, not measured customer results.

## Local files

The `.gitignore` excludes credentials, editor files, generated archives, and local research/editing notes.
