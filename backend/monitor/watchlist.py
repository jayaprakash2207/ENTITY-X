"""
backend.monitor.watchlist – Scheduled content watchlist scanner.

Loads all active watchlist items from DB and scans them periodically:
  • keyword items  → searches RSS feeds for matching headlines
  • url items      → re-fetches the URL and runs heuristic risk scoring

Fires DB alerts when suspicious content is found above the threshold.
Designed to be registered with BackgroundScheduler on app startup.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from urllib.parse import urlparse, quote_plus

import httpx

logger = logging.getLogger(__name__)

_RSS_SOURCES = [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://rss.cnn.com/rss/edition.rss",
    "https://feeds.reuters.com/reuters/topNews",
]


def _simple_risk(text: str) -> float:
    """Heuristic risk score based on sensational language patterns."""
    HIGH_WORDS = {
        "fake", "hoax", "manipulated", "deepfake", "false", "misinformation",
        "disinformation", "fabricated", "doctored", "synthetic", "ai-generated",
        "misleading", "debunked", "fraud", "scam",
    }
    words = set(text.lower().split())
    hits  = len(words & HIGH_WORDS)
    return min(hits / 4.0, 1.0)


async def _scan_keyword_item(item: dict, client: httpx.AsyncClient) -> list[dict]:
    """Search RSS sources for articles matching the keyword."""
    keyword = (item.get("keyword") or "").lower().strip()
    if not keyword:
        return []

    alerts = []
    for feed_url in _RSS_SOURCES:
        try:
            resp = await client.get(feed_url, timeout=8.0)
            text = resp.text.lower()
            if keyword not in text:
                continue
            # Extract titles that contain the keyword
            import re
            titles = re.findall(r"<title><!\[CDATA\[(.*?)\]\]></title>|<title>(.*?)</title>", resp.text, re.DOTALL)
            links  = re.findall(r"<link>(https?://[^<]+)</link>", resp.text)
            for idx, (cdata, plain) in enumerate(titles):
                title = (cdata or plain).strip()
                if keyword not in title.lower():
                    continue
                risk = _simple_risk(title)
                if risk < item.get("threshold", 0.3):
                    continue
                source_url = links[idx] if idx < len(links) else feed_url
                risk_label = "HIGH" if risk >= 0.6 else "MEDIUM" if risk >= 0.3 else "LOW"
                alerts.append({
                    "title":           title,
                    "source_url":      source_url,
                    "risk_level":      risk_label,
                    "fake_probability": risk,
                })
        except Exception as exc:
            logger.debug(f"[watchlist] RSS fetch failed for {feed_url}: {exc}")

    return alerts


async def _scan_url_item(item: dict, client: httpx.AsyncClient) -> list[dict]:
    """Fetch a URL and check if its content seems suspicious."""
    url = (item.get("url") or "").strip()
    if not url:
        return []
    try:
        resp  = await client.get(url, timeout=10.0, follow_redirects=True)
        text  = resp.text[:8000]
        risk  = _simple_risk(text)
        threshold = item.get("threshold", 0.5)
        if risk < threshold:
            return []
        risk_label = "HIGH" if risk >= 0.6 else "MEDIUM"
        return [{"title": f"Watchlist URL triggered: {urlparse(url).netloc}",
                 "source_url": url, "risk_level": risk_label, "fake_probability": risk}]
    except Exception as exc:
        logger.debug(f"[watchlist] URL scan failed for {url}: {exc}")
        return []


async def run_watchlist_scan() -> None:
    """
    Single scan pass — called by BackgroundScheduler every N minutes.
    Iterates all active watchlist items and fires alerts on matches.
    """
    from backend.db.database import (
        db_list_watchlist, db_add_watchlist_alert, db_list_watchlist
    )

    items = await db_list_watchlist()
    if not items:
        return

    logger.info(f"[watchlist] Scanning {len(items)} watchlist item(s)")
    now = int(time.time() * 1000)

    async with httpx.AsyncClient(headers={"User-Agent": "EntityX/1.0"}) as client:
        for item in items:
            try:
                wtype  = item.get("watch_type", "keyword")
                alerts = []
                if wtype == "keyword":
                    alerts = await _scan_keyword_item(item, client)
                elif wtype == "url":
                    alerts = await _scan_url_item(item, client)

                for alert in alerts:
                    await db_add_watchlist_alert(item["id"], alert)
                    logger.info(f"[watchlist] Alert: '{alert['title'][:60]}' risk={alert['risk_level']}")

            except Exception as exc:
                logger.warning(f"[watchlist] Error scanning item {item.get('id')}: {exc}")
