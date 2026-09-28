# Utana Agentic Technologies

Responsive static website for Utana, with a navy and silver design, automation use cases, articles, team profiles, and an email contact experience.

## Build and preview the production site

From this directory:

```sh
./scripts/build-public.sh
python3 -m http.server 8766 --directory public
```

Open http://localhost:8766. The build uses `public-files.txt` as an explicit
allowlist, recreates `public/`, and verifies that every local page and asset
reference resolves inside that directory. It also checks canonical, social,
favicon, robots, and sitemap metadata. It requires only POSIX shell tools and
Python 3; no packages need to be installed.

## Canonical URL policy

Production pages use explicit `.html` URLs, including `index.html` for the
homepage. Internal links use that form consistently; extensionless paths are not
part of the site's URL contract.

The production origin for absolute discovery metadata is
`https://utana.agentic.technologies`.

Preview and alternate-theme pages are not copied into the production artifact.
The eight historical use-case aliases are also omitted rather than published as
HTML redirects. The repository has no deployment-runtime redirect facility with
which to guarantee portable HTTP 301 responses, so no HTTP aliases are retained.
If a hosting platform is chosen later, backwards-compatible aliases can be added
in that platform's redirect layer.

## Website files

- `index.html`: main landing page
- `styles.css` and `navy.css`: shared layout, responsive styles, and colours
- `site.js`: navigation and decorative motion
- `use-cases.html`, `use-cases/`, and `use-cases.css`: automation workflow library
- `blog/`: articles linked from the homepage
- `assets/team/`: team portraits
- `privacy.html`: privacy information
- `preview-*.html`, `navy.html`, and `blog-navy/`: design variants and alternate pages

## Deploy

Run `./scripts/build-public.sh`, then deploy or serve only the generated
`public/` directory, with `public/index.html` at the site root. Do not configure
the web server's document root to the repository root. Preview pages, repository
metadata, unused assets, and build tooling are intentionally absent from the
artifact.

The production Ubuntu, Nginx, HTTPS, redirect, caching, error-page, and
certificate-renewal procedure is documented in [`deploy/README.md`](deploy/README.md).

## Contact

The contact CTA opens the visitor's email application with a pre-filled subject addressed to `info@utana.agentic.technologies`. The visitor must write and send the email themselves. The address remains visible and copyable if no mail application is configured. The website has no submission backend or contact database.

Google Fonts are loaded remotely with system-font fallbacks. Workflow articles describe proposed implementations, not measured customer results.

## Local files

The `.gitignore` excludes credentials, editor files, generated archives, and local research/editing notes.
