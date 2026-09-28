# Ubuntu production deployment

The production hostname is `utana.agentic.technologies`; `www.utana.agentic.technologies` is a redirect-only alias. Both DNS records must point to the VPS, and the TLS certificate must contain both names. Nginx serves only the allowlisted `public/` artifact from `/var/www/utana/public`.

## Build and publish the artifact

Run the build and verification before each deployment:

```sh
./scripts/build-public.sh
python3 scripts/verify-public.py public public-files.txt
sudo install -d -o root -g www-data -m 0755 /var/www/utana/public
sudo rsync -a --delete --chown=root:www-data public/ /var/www/utana/public/
```

Do not point Nginx at the repository checkout. The `--delete` deployment keeps the server directory identical to the allowlisted artifact.

## Bootstrap HTTPS

Install Nginx, Certbot, and the temporary HTTP-only site before requesting the first certificate:

```sh
sudo apt-get update
sudo apt-get install nginx certbot
sudo install -d -o root -g www-data -m 0755 /var/www/letsencrypt/.well-known/acme-challenge
sudo install -o root -g root -m 0644 deploy/nginx/utana-bootstrap.conf /etc/nginx/sites-available/utana-bootstrap.conf
sudo ln -s /etc/nginx/sites-available/utana-bootstrap.conf /etc/nginx/sites-enabled/utana-bootstrap.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt \
  -d utana.agentic.technologies -d www.utana.agentic.technologies
```

The bootstrap config serves only `/.well-known/acme-challenge/`; every other HTTP request redirects to the canonical HTTPS hostname. Certificate issuance requires both DNS records and inbound port 80 to work first.

## Enable production Nginx

After the certificate exists, replace the bootstrap site with the production config:

```sh
sudo install -o root -g root -m 0644 deploy/nginx/utana.conf /etc/nginx/sites-available/utana.conf
sudo rm -f /etc/nginx/sites-enabled/utana-bootstrap.conf
sudo ln -s /etc/nginx/sites-available/utana.conf /etc/nginx/sites-enabled/utana.conf
sudo nginx -t
sudo systemctl reload nginx
```

Never enable the bootstrap and production configs together because both claim the default port 80 listener.

## Certificate renewal

Install the deploy hook and enable Certbot's systemd timer:

```sh
sudo install -o root -g root -m 0755 \
  deploy/letsencrypt/renewal-hooks/deploy/reload-nginx \
  /etc/letsencrypt/renewal-hooks/deploy/reload-nginx
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
systemctl list-timers certbot.timer
```

The ACME exception remains available over HTTP. A successful renewal validates the new Nginx configuration before reloading it.

## Production checks

Run these after deployment (replace the deliberately missing path only if it becomes a real page):

```sh
curl -I http://www.utana.agentic.technologies/index.html
curl -I https://www.utana.agentic.technologies/index.html
curl -I https://utana.agentic.technologies/index.html
curl -I https://utana.agentic.technologies/use-cases/kpn-proposals.html
curl -I https://utana.agentic.technologies/definitely-missing.html
curl -I https://utana.agentic.technologies/.git/config
curl --compressed -sS -D - -o /dev/null https://utana.agentic.technologies/styles.css
```

Expect canonical 301 redirects, a `404` response using the branded page, `403` for denied paths, gzip when the client advertises it, security headers on all canonical responses, `no-cache` for HTML, and a short revalidated lifetime for the current non-fingerprinted assets.

## HSTS decision

HSTS is intentionally not enabled. Before adding it, confirm the canonical and `www` DNS records, successful unattended renewal, the complete HTTP-to-HTTPS redirect chain, and continuous HTTPS availability. Start with a small `max-age` and no `includeSubDomains`; use `includeSubDomains` only after every subdomain is confirmed HTTPS-only. Preloading is a separate irreversible operational decision and is not assumed by this configuration.
