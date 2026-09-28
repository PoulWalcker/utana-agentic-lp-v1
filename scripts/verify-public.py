#!/usr/bin/env python3
"""Verify that a production artifact matches its allowlist and is self-contained."""

from __future__ import annotations

import posixpath
import re
import sys
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit


REFERENCE_ATTRIBUTES = {"action", "href", "poster", "src"}
CSS_URL = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE)
LEGACY_ALIAS_PATHS = {
    "use-cases/dentsu-media.html",
    "use-cases/kpn-proposals.html",
    "use-cases/lumen-sales.html",
    "use-cases/microsoft-campaigns.html",
    "use-cases/morgan-stanley-knowledge.html",
    "use-cases/oscar-claims.html",
    "use-cases/retailer-invoices.html",
    "use-cases/thyssenkrupp-engineering.html",
}


class ReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: list[str] = []
        self.has_meta_refresh = False

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag == "meta":
            attributes = {name: value for name, value in attrs}
            http_equiv = attributes.get("http-equiv")
            if http_equiv and http_equiv.strip().lower() == "refresh":
                self.has_meta_refresh = True

        for name, value in attrs:
            if not value:
                continue
            if name in REFERENCE_ATTRIBUTES:
                self.references.append(value)
            elif name == "srcset":
                self.references.extend(
                    candidate.strip().split()[0]
                    for candidate in value.split(",")
                    if candidate.strip()
                )


def manifest_paths(manifest: Path) -> list[PurePosixPath]:
    paths: list[PurePosixPath] = []
    seen: set[PurePosixPath] = set()

    for line_number, raw_line in enumerate(
        manifest.read_text(encoding="utf-8").splitlines(), start=1
    ):
        value = raw_line.strip()
        if not value or value.startswith("#"):
            continue

        path = PurePosixPath(value)
        if path.is_absolute() or value != posixpath.normpath(value) or ".." in path.parts:
            raise ValueError(f"unsafe manifest path on line {line_number}: {value}")
        if path in seen:
            raise ValueError(f"duplicate manifest path on line {line_number}: {value}")

        seen.add(path)
        paths.append(path)

    if not paths:
        raise ValueError("manifest does not contain any files")
    return paths


def is_forbidden(path: PurePosixPath) -> bool:
    return (
        ".git" in path.parts
        or path.as_posix() in LEGACY_ALIAS_PATHS
        or path.name in {".gitignore", "README.md", "navy.html", "privacy-navy.html"}
        or path.name.startswith("preview-")
        or path.parts[0] == "blog-navy"
        or path.name
        in {
            "comparison.css",
            "motion-options.css",
            "motion-options.js",
            "shape-options.css",
            "shape-options.js",
        }
    )


def local_target(artifact: Path, source: Path, reference: str) -> Path | None:
    parsed = urlsplit(reference)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return None

    decoded_path = unquote(parsed.path)
    if decoded_path.startswith("/"):
        target = artifact / decoded_path.lstrip("/")
    else:
        target = source.parent / decoded_path

    target = target.resolve()
    try:
        target.relative_to(artifact)
    except ValueError as error:
        raise ValueError(f"reference escapes the artifact: {reference}") from error

    if decoded_path.endswith("/"):
        target /= "index.html"
    return target


def parse_page(path: Path) -> ReferenceParser:
    parser = ReferenceParser()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    return parser


def css_references(path: Path) -> list[str]:
    return [match.group(2) for match in CSS_URL.finditer(path.read_text(encoding="utf-8"))]


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: verify-public.py ARTIFACT MANIFEST", file=sys.stderr)
        return 2

    artifact = Path(sys.argv[1]).resolve()
    manifest = Path(sys.argv[2]).resolve()

    try:
        expected = manifest_paths(manifest)
    except (OSError, ValueError) as error:
        print(f"Manifest error: {error}", file=sys.stderr)
        return 1

    actual = {
        PurePosixPath(path.relative_to(artifact).as_posix())
        for path in artifact.rglob("*")
        if path.is_file()
    }
    expected_set = set(expected)
    errors: list[str] = []

    for path in sorted(expected_set - actual):
        errors.append(f"missing allowlisted file: {path}")
    for path in sorted(actual - expected_set):
        errors.append(f"unexpected file: {path}")
    for path in sorted(actual):
        if is_forbidden(path):
            errors.append(f"forbidden public file: {path}")

    for relative_path in sorted(actual):
        source = artifact / relative_path
        if source.suffix.lower() in {".html", ".htm"}:
            page = parse_page(source)
            references = page.references
            if page.has_meta_refresh:
                errors.append(f"{relative_path}: meta-refresh redirects are forbidden")
        elif source.suffix.lower() == ".css":
            references = css_references(source)
        else:
            continue

        for reference in references:
            try:
                target = local_target(artifact, source, reference)
            except ValueError as error:
                errors.append(f"{relative_path}: {error}")
                continue
            if target is not None and not target.is_file():
                errors.append(f"{relative_path}: missing local reference: {reference}")
            elif target is not None and target.suffix.lower() in {".html", ".htm"}:
                reference_path = unquote(urlsplit(reference).path)
                if not reference_path.lower().endswith(".html"):
                    errors.append(
                        f"{relative_path}: non-canonical local page reference: {reference}"
                    )

    if errors:
        print("Public artifact verification failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        f"Verified {len(actual)} files; all local references resolve inside the artifact."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
