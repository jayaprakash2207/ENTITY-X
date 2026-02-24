"""
backend.monitor.image_scanner – safe remote image fetcher.

SafeImageFetcher validates URLs, blocks SSRF targets, enforces size limits,
verifies content-type, and checks magic bytes before returning raw image
bytes to the caller.
"""
from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB hard cap
REQUEST_TIMEOUT_SECONDS = 6.0

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
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

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    async def fetch(self, image_url: str) -> bytes:
        """
        Fetch and return raw image bytes from *image_url*.

        Raises:
            HTTPException(400)  Invalid URL or private/reserved host.
            HTTPException(413)  Image exceeds size cap.
            HTTPException(415)  Unsupported content type.
            HTTPException(422)  Fetch failed or empty payload.
        """
        self._validate_url_format(image_url)
        await self._ensure_public_host(image_url)

        limits = httpx.Limits(max_keepalive_connections=10, max_connections=20)
        async with httpx.AsyncClient(
            timeout=self.timeout, follow_redirects=True, limits=limits
        ) as client:
            async with client.stream(
                "GET", image_url, headers={"User-Agent": "EntityXMonitor/0.1"}
            ) as response:
                if response.status_code != 200:
                    raise HTTPException(
                        status_code=422,
                        detail="Unable to fetch image from the provided URL",
                    )

                content_type = (
                    (response.headers.get("content-type") or "")
                    .split(";")[0]
                    .strip()
                    .lower()
                )
                if content_type and content_type not in ALLOWED_CONTENT_TYPES:
                    raise HTTPException(
                        status_code=415,
                        detail="Content type is not a supported image format",
                    )

                advertised_size = response.headers.get("content-length")
                if (
                    advertised_size
                    and advertised_size.isdigit()
                    and int(advertised_size) > self.max_bytes
                ):
                    raise HTTPException(
                        status_code=413,
                        detail="Image exceeds maximum allowed size",
                    )

                collected = bytearray()
                async for chunk in response.aiter_bytes(64 * 1024):
                    if not chunk:
                        continue
                    collected.extend(chunk)
                    if len(collected) > self.max_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail="Image exceeds maximum allowed size",
                        )

                if not collected:
                    raise HTTPException(
                        status_code=422, detail="Fetched payload is empty"
                    )

                if not content_type and not self._looks_like_image_bytes(collected):
                    raise HTTPException(
                        status_code=415,
                        detail="Fetched payload does not appear to be an image",
                    )

                return bytes(collected)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

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
