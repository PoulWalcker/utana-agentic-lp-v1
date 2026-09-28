# Utana Agentic Technologies

Responsive static website for Utana, with a navy and silver design, automation use cases, articles, team profiles, and an email contact experience.

## Build and preview the production site

From this directory:

```sh
./scripts/build-public.sh
python3 -m http.server 8766 --directory public
```

Open http://localhost:8766. The build uses `public-files.txt` as an explicit
artifact-path allowlist, resolves each entry from `src/pages/`, `src/styles/`,
`src/js/`, or `static/`, and recreates `public/` with the site's public URL
layout. It verifies that every local page and asset reference and fragment
resolves inside that directory. It also checks basic HTML structure, unique
IDs, canonical, social, favicon, robots, and sitemap metadata. It requires only
POSIX shell tools and Python 3; no packages need to be installed.

## Launch validation

Run the complete production gate from a clean checkout:

```sh
./scripts/validate-launch.sh
```

The command builds the allowlisted artifact, reruns the artifact and SEO
checks, checks the Git diff for whitespace errors, and exercises `public/` in
headless Chrome at desktop and mobile sizes. The browser smoke covers primary
navigation, the mobile menu, keyboard focus and Escape behavior, the skip link,
the email CTA target, representative blog and use-case articles, the custom
404, broken images, horizontal overflow, layout shift, console/network errors,
and reduced-motion behavior. It writes review screenshots to
`/tmp/utana-launch-screenshots` by default; set `SCREENSHOT_DIR` to override it.

Chrome or Chromium and Node.js are required for the browser portion. Set
`CHROME_BIN` when the browser is not installed in a standard macOS or Linux
location. No Node packages or browser framework are required.

## Browser support

The supported baseline is the current and previous major releases of Chrome,
Edge, Firefox, and Safari, including current iOS Safari and Android Chrome.
The launch gate runs in the locally installed Chrome/Chromium; release review
should still sample Safari and Firefox when their rendering engines are
available.

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

## Repository structure

- `src/pages/`: canonical HTML sources. Nested `blog/` and `use-cases/`
  directories mirror their production URL paths. Historical use-case alias
  stubs are retained here for reference but are not allowlisted.
- `src/styles/`: canonical stylesheets copied to the artifact root.
- `src/js/`: canonical browser JavaScript copied to the artifact root.
- `src/experiments/`: preview pages, alternate themes, and their supporting
  styles and scripts. These files can reference the reorganized source tree for
  local review, but are never copied to production.
- `static/`: assets and root-level static files copied without changing their
  public paths, including icons, team images, `robots.txt`, and `sitemap.xml`.
- `scripts/`: build and launch-validation tooling.
- `deploy/`: Nginx and certificate-renewal configuration. Deployment reads
  only the generated artifact.
- `public-files.txt`: the authoritative list of paths that may appear under
  `public/`; entries are public artifact paths, not repository source paths.
- `public/`: generated, gitignored production output. Do not edit it directly.

Canonical HTML keeps links in terms of the production URL layout. Build the
site before previewing canonical pages so those references resolve exactly as
they do after deployment.

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

## Maintenance decisions

- Preview themes and their supporting styles/scripts are intentionally retained
  under `src/experiments/` as repository-only design history. Historical alias
  stubs remain under `src/pages/use-cases/`; the public-file allowlist excludes
  both groups.
- Team portraits include AVIF and JPEG widths used by responsive `picture`
  sources. The social image and icon variants are referenced by page metadata.
  No allowlisted asset is currently unreferenced, so none is removed.
- Shared CSS selectors used by canonical pages, responsive states, scripted
  reveal/menu states, and repository-only previews are retained. Static usage
  alone cannot prove the responsive/scripted selectors dead, and launch review
  found no cleanup worth the regression risk.
- Structured data is deferred until the business can maintain accurate entity
  and service facts. Existing canonical and social metadata remains the
  supported discovery surface.
- Explicit `.html` URLs remain the canonical policy. Extensionless URL cleanup
  is deferred because it requires host-level redirects and would reopen the
  established URL contract.

## Local files

The `.gitignore` excludes credentials, editor files, generated archives, and local research/editing notes.
