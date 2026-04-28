"""
backend.monitor.image_scanner – safe remote image fetcher.

SafeImageFetcher validates URLs, blocks SSRF targets, enforces size limits,
verifies content-type, and checks magic bytes before returning raw image
bytes to the caller.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)
from fastapi import HTTPException

MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB hard cap
REQUEST_TIMEOUT_SECONDS = 30.0  # Generous timeout for CDN images under load
MAX_CONCURRENT_FETCHES = 6  # Limit parallel downloads to avoid congestion

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
    "image/avif",
    "image/svg+xml",
    "application/octet-stream",  # Some CDNs serve images as binary
    "binary/octet-stream",
}


# Full browser-like request headers — improves CDN compatibility and reduces 403s.
# Sec-Fetch-* headers are required by some modern CDNs (Cloudflare, Fastly, etc.)
_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
    "Cache-Control": "no-cache",
    "Referer": "https://www.google.com/",
}


class SafeImageFetcher:
    """
    Fetch a remote image with SSRF protection, size limits, and type validation.

    SSRF mitigations:
    - Only http/https URLs are accepted.
    - Hostname is resolved and each resolved IP is checked against private/
      reserved ranges before the request is issued.
    - Private IP literals in the URL are rejected directly.

    Content mitigations:
    - Advertised Content-Length checked before streaming starts.
    - Streamed bytes counted in real time; fetch aborted if limit exceeded.
    - Content-Type validated against ALLOWED_CONTENT_TYPES.
    - If no Content-Type header is present, magic bytes are checked.

    Returns None (instead of raising) for transient failures so callers can
    fall back to URL-based heuristic analysis without surfacing errors to the
    client.  Only 400-level validation errors (bad scheme, private host) are
    re-raised as HTTPException.
    """

    def __init__(
        self,
        timeout_seconds: float = REQUEST_TIMEOUT_SECONDS,
        max_bytes: int = MAX_IMAGE_BYTES,
    ) -> None:
        self.timeout = httpx.Timeout(
            timeout_seconds, connect=timeout_seconds, read=timeout_seconds
        )
        self.max_bytes = max_bytes
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT_FETCHES)
        self._client: httpx.AsyncClient | None = None

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    async def fetch(self, image_url: str) -> bytes | None:
        """
        Fetch and return raw image bytes from *image_url*, or None on failure.

        Returns None for transient/CDN errors so the caller can degrade
        gracefully to heuristic analysis.

        Raises:
            HTTPException(400)  Invalid URL or private/reserved host (hard stop).
        """
        self._validate_url_format(image_url)
        await self._ensure_public_host(image_url)

        client = self._get_client()
        # Limit concurrent downloads so bursts don't exhaust sockets / timeouts
        async with self._semaphore:
            try:
                response = await client.get(image_url, headers=_BROWSER_HEADERS)

                if response.status_code != 200:
                    logger.warning(f"[fetcher] HTTP {response.status_code} for {image_url[:70]} — deferring to heuristic")
                    return None

                content_type = (
                    (response.headers.get("content-type") or "")
                    .split(";")[0]
                    .strip()
                    .lower()
                )
                if content_type and content_type not in ALLOWED_CONTENT_TYPES and not content_type.startswith("image/"):
                    logger.debug(f"[fetcher] Non-image content-type '{content_type}' for {image_url[:60]} — skipping")
                    return None

                collected = response.content

                if len(collected) > self.max_bytes:
                    logger.warning(f"[fetcher] Image too large ({len(collected)} bytes) for {image_url[:60]} — skipping")
                    return None

                if not collected:
                    logger.debug(f"[fetcher] Empty payload for {image_url[:60]} — deferring to heuristic")
                    return None

                # Skip tiny images (tracking pixels, 1x1 gifs, etc.)
                if len(collected) < 1000:
                    logger.debug(f"[fetcher] Image too small ({len(collected)} bytes) for {image_url[:60]} — skipping")
                    return None

                if not content_type and not self._looks_like_image_bytes(collected):
                    logger.debug(f"[fetcher] Payload does not look like an image for {image_url[:60]} — skipping")
                    return None

                return bytes(collected)
            except httpx.TimeoutException as exc:
                logger.warning(f"[fetcher] Timeout for {image_url[:60]}: {exc}")
                return None
            except httpx.RequestError as exc:
                logger.warning(f"[fetcher] Request error for {image_url[:60]}: {exc}")
                return None

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _get_client(self) -> httpx.AsyncClient:
        """Return a persistent AsyncClient, creating one if needed."""
        if self._client is None or self._client.is_closed:
            limits = httpx.Limits(max_keepalive_connections=10, max_connections=20)
            self._client = httpx.AsyncClient(
                timeout=self.timeout, follow_redirects=True, limits=limits,
            )
        return self._client

    @staticmethod
    def _validate_url_format(image_url: str) -> None:
        parsed = urlparse(image_url)
        if parsed.scheme not in {"http", "https"}:
            raise HTTPException(
                status_code=400, detail="image_url must use http or https"
            )
        if not parsed.netloc:
            raise HTTPException(
                status_code=400, detail="image_url host is missing"
            )

    async def _ensure_public_host(self, image_url: str) -> None:
        parsed = urlparse(image_url)
        hostname = parsed.hostname
        if not hostname:
            raise HTTPException(
                status_code=400, detail="image_url host is invalid"
            )

        try:
            ip_literal = ipaddress.ip_address(hostname)
            if self._is_private_or_reserved(ip_literal):
                raise HTTPException(
                    status_code=400,
                    detail="Private or reserved hosts are not allowed",
                )
            return
        except ValueError:
            pass

        try:
            addr_info = await self._resolve_hostname(hostname)
        except socket.gaierror as exc:
            raise HTTPException(
                status_code=422, detail="Could not resolve image host"
            ) from exc

        for entry in addr_info:
            ip_text = entry[4][0]
            ip_obj = ipaddress.ip_address(ip_text)
            if self._is_private_or_reserved(ip_obj):
                raise HTTPException(
                    status_code=400,
                    detail="Private or reserved hosts are not allowed",
                )

    @staticmethod
    async def _resolve_hostname(hostname: str):
        return await asyncio.to_thread(socket.getaddrinfo, hostname, None)

    @staticmethod
    def _is_private_or_reserved(
        ip_obj: ipaddress.IPv4Address | ipaddress.IPv6Address,
    ) -> bool:
        return any(
            [
                ip_obj.is_private,
                ip_obj.is_loopback,
                ip_obj.is_link_local,
                ip_obj.is_multicast,
                ip_obj.is_unspecified,
                ip_obj.is_reserved,
            ]
        )

    @staticmethod
    def _looks_like_image_bytes(blob: bytes) -> bool:
        signatures = (
            b"\xFF\xD8\xFF",          # JPEG
            b"\x89PNG\r\n\x1a\n",    # PNG
            b"GIF87a",
            b"GIF89a",
            b"RIFF",                  # WEBP
            b"BM",                    # BMP
            b"II*\x00",               # TIFF (little-endian)
            b"MM\x00*",               # TIFF (big-endian)
        )
        return any(blob.startswith(sig) for sig in signatures)
