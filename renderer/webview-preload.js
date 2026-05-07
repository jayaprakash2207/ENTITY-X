/**
 * WEBVIEW PRELOAD
 * 
 * This script runs inside the <webview> context (isolated from main renderer).
 * It:
 * 1. Confirms preload loaded to main process
 * 2. Injects image observer into the webpage
 * 3. Sends detected image URLs back to main process
 * 4. Includes retry logic for observer installation
 */

const { ipcRenderer } = require('electron');

/* ============= INITIALIZATION ============= */

/* Confirm preload loaded */
console.log('[WEBVIEW-PRELOAD] Preload script executing...');
ipcRenderer.send('webview-preload:loaded');
console.log('[WEBVIEW-PRELOAD] Sent loaded confirmation to main');

/* ============= IMAGE OBSERVER ============= */

const IMAGE_URLS_SEEN = new Set();

function installImageObserver() {
  /* Guard against double-installation */
  if (window.__imageObserverInstalled) {
    console.log('[WEBVIEW] Image observer already installed');
    return;
  }
  window.__imageObserverInstalled = true;

  console.log('[WEBVIEW] Installing image observer...');

  /**
   * Report a single image URL to main process (deduplicated)
   */
  function reportImageUrl(url) {
    if (!url || typeof url !== 'string' || url.trim() === '') {
      console.log('[WEBVIEW] Skipping invalid URL:', url);
      return;
    }
    if (IMAGE_URLS_SEEN.has(url)) {
      console.log('[WEBVIEW] Skipping already-seen URL');
      return;
    }

    IMAGE_URLS_SEEN.add(url);
    console.log(`[WEBVIEW] Reporting image: ${url}`);
    ipcRenderer.send('webview:image-url', url);
  }

  /**
   * Watch a single <img> element
   */
  function watchImage(img) {
    if (!(img instanceof HTMLImageElement)) return;

    function sendCurrentUrl() {
      reportImageUrl(img.currentSrc || img.src);
    }

    /* If already loaded, report immediately */
    if (img.complete) {
      sendCurrentUrl();
    }

    /* Watch for future load events */
    img.addEventListener('load', sendCurrentUrl, { passive: true });
  }

  /* Scan existing images */
  const existingImages = document.querySelectorAll('img');
  console.log(`[WEBVIEW] Found ${existingImages.length} existing images`);
  existingImages.forEach(watchImage);

  /* Watch for dynamically added images */
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLImageElement) {
            console.log('[WEBVIEW] Detected dynamically added img element');
            watchImage(node);
          } else if (node instanceof Element) {
            const imgs = node.querySelectorAll('img');
            if (imgs.length > 0) console.log(`[WEBVIEW] Found ${imgs.length} imgs in dynamic node`);
            imgs.forEach(watchImage);
          }
        }
      }
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });
  console.log('[WEBVIEW] MutationObserver installed');
}

/* ============= INSTALL WITH RETRY ============= */

/**
 * Retry observer installation on document ready, then after delays
 * to catch lazy-loaded images
 */
if (document.readyState === 'loading') {
  console.log('[WEBVIEW] Document still loading, deferring observer...');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[WEBVIEW] DOMContentLoaded fired, installing observer');
    installImageObserver();
  }, { once: true });
} else {
  console.log('[WEBVIEW] Document already loaded, installing observer immediately');
  installImageObserver();
}

/* Retry after brief delay for images added via async script */
setTimeout(() => {
  console.log('[WEBVIEW] Retry #1 (500ms)');
  installImageObserver();
}, 500);
setTimeout(() => {
  console.log('[WEBVIEW] Retry #2 (1500ms)');
  installImageObserver();
}, 1500);
setTimeout(() => {
  console.log('[WEBVIEW] Retry #3 (4000ms)');
  installImageObserver();
}, 4000);

/* Retry on manual navigation */
window.addEventListener('load', () => {
  console.log('[WEBVIEW] Window load event fired');
  installImageObserver();
}, { once: false });

/* ============= TEXT/ARTICLE MONITORING ============= */
/*
 * Design: antivirus-style silent monitoring.
 * - Extracts article text automatically on every page load.
 * - MutationObserver disconnects after a successful send (no ongoing overhead).
 * - Hard ceiling timer ensures extraction fires even on constantly-mutating pages
 *   (news feeds that keep inserting ad/social nodes would otherwise reset the
 *   debounce forever).
 * - SPA navigation (pushState) is detected via a URL poll so each new article
 *   gets its own analysis without reloading the preload script.
 */

/** URLs that have already been successfully analyzed this session */
const TEXT_URLS_ANALYZED = new Set();

/** Tags whose subtrees we skip entirely */
const TEXT_SKIP_TAGS = new Set([
  'script', 'style', 'nav', 'footer', 'noscript', 'aside',
  'header', 'iframe', 'svg', 'form', 'button', 'select', 'option'
]);

/** Class/id patterns that mark non-article content */
const TEXT_SKIP_PATTERN = /\b(nav|menu|sidebar|header|footer|comment|ad[-_]|advertisement|social|share|cookie|promo|banner|related|recommend|widget|popup|modal|newsletter|subscribe)\b/i;

let _textDebounceTimer = null; // resets on each mutation
let _textCeilingTimer  = null; // hard ceiling — fires regardless
let _textMutObserver   = null; // current MutationObserver instance
let _currentPageUrl    = window.location.href;

/**
 * Walk the DOM and collect prose text, skipping noise.
 * Returns the trimmed text string, or '' if nothing useful found.
 */
function _collectText(root) {
  const parts = [];
  const walk = (el) => {
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent.trim();
        if (t.length > 3) parts.push(t);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (TEXT_SKIP_TAGS.has(tag)) continue;
        const cls = (typeof child.className === 'string' ? child.className : '') + ' ' + (child.id || '');
        if (TEXT_SKIP_PATTERN.test(cls)) continue;
        walk(child);
      }
    }
  };
  walk(root);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Pick the best content container, preferring semantic article elements.
 */
function _pickContainer() {
  return (
    document.querySelector('article') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('main') ||
    document.querySelector(
      '.article-body,.post-body,.entry-content,.story-body,.article__body,.content-body,.post-content'
    ) ||
    document.body
  );
}

/**
 * Try to extract readable text from the current page.
 * Returns a payload object, or null if the page doesn't qualify.
 */
function _extractPayload() {
  const url = window.location.href;
  if (TEXT_URLS_ANALYZED.has(url)) return null; // already sent for this URL

  const container = _pickContainer();
  let text = _collectText(container);

  const words = text.split(/\s+/).filter(w => w.length > 1);
  if (words.length < 150) {
    // Not enough article content yet
    return null;
  }

  // Cap text to avoid oversized payloads (~500 words is plenty for analysis)
  if (words.length > 500) text = words.slice(0, 500).join(' ');

  return {
    title: document.title || 'Untitled',
    url,
    text,
    word_count: words.length,
    timestamp: Date.now()
  };
}

/**
 * Attempt extraction and, if successful, send to main process.
 * After a successful send the observer is disconnected — job done for this URL.
 */
function _tryExtractAndSend() {
  const payload = _extractPayload();
  if (!payload) return;

  // Mark before sending to prevent racing mutations from sending twice
  TEXT_URLS_ANALYZED.add(payload.url);
  _stopTextObserver(); // disconnect — no more monitoring needed for this URL

  console.log(
    `[WEBVIEW-TEXT] Sending: "${payload.title.substring(0, 50)}" | ` +
    `${payload.word_count} words | ${payload.url.substring(0, 60)}`
  );
  ipcRenderer.send('webview:text-content', payload);
}

/** Disconnect MutationObserver and clear all pending timers. */
function _stopTextObserver() {
  if (_textMutObserver) {
    _textMutObserver.disconnect();
    _textMutObserver = null;
  }
  clearTimeout(_textDebounceTimer);
  clearTimeout(_textCeilingTimer);
}

/**
 * Begin monitoring the current page for article text.
 * Safe to call multiple times — bails out if already analyzed or in progress.
 */
function startTextMonitorForPage() {
  const url = window.location.href;
  if (TEXT_URLS_ANALYZED.has(url)) return;

  _currentPageUrl = url;

  // Stop any previous observer (e.g. lingering from SPA navigation)
  _stopTextObserver();

  function scheduleDebounce() {
    clearTimeout(_textDebounceTimer);
    _textDebounceTimer = setTimeout(_tryExtractAndSend, 2500);
  }

  // Hard ceiling: guarantees extraction fires within 8s even if the page
  // keeps inserting DOM nodes (ads, live tickers, etc.) that reset the debounce.
  _textCeilingTimer = setTimeout(_tryExtractAndSend, 8000);

  // Initial check now (works for already-loaded pages)
  scheduleDebounce();

  // MutationObserver: watch for content that loads asynchronously
  _textMutObserver = new MutationObserver(() => {
    // If the URL changed mid-observation (SPA), let the URL poller handle it
    if (window.location.href !== _currentPageUrl) {
      _stopTextObserver();
      return;
    }
    scheduleDebounce();
  });

  _textMutObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  console.log(`[WEBVIEW-TEXT] Monitoring started for: ${url.substring(0, 60)}`);
}

/* ---- Bootstrap ---- */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startTextMonitorForPage, { once: true });
} else {
  startTextMonitorForPage();
}

// After full page load, re-run in case lazy content hadn't rendered yet
window.addEventListener('load', () => {
  setTimeout(startTextMonitorForPage, 800);
});

/* ---- SPA navigation detection via URL polling ----
 * Electron webview doesn't re-run the preload on pushState/replaceState
 * navigations, so we poll every second. Overhead is negligible.
 */
setInterval(() => {
  const current = window.location.href;
  if (current !== _currentPageUrl) {
    _currentPageUrl = current;
    console.log(`[WEBVIEW-TEXT] SPA nav detected → ${current.substring(0, 60)}`);
    // Give the SPA a moment to render the new route's content
    setTimeout(startTextMonitorForPage, 1800);
  }
}, 1000);

/* ============= VIDEO MONITORING ============= */
/*
 * Detects video elements and reports their src URLs for deepfake analysis.
 * Similar to image monitoring but handles <video> and <source> elements.
 */

const VIDEO_URLS_SEEN = new Set();

function installVideoObserver() {
  if (window.__videoObserverInstalled) {
    console.log('[WEBVIEW] Video observer already installed');
    return;
  }
  window.__videoObserverInstalled = true;

  console.log('[WEBVIEW] Installing video observer...');

  /**
   * Report a video URL to main process (deduplicated)
   */
  function reportVideoUrl(url) {
    if (!url || typeof url !== 'string' || url.trim() === '') return;
    if (VIDEO_URLS_SEEN.has(url)) return;
    if (url.startsWith('blob:') || url.startsWith('data:')) return; // Skip blob/data URLs

    VIDEO_URLS_SEEN.add(url);
    console.log(`[WEBVIEW] Reporting video: ${url.substring(0, 80)}...`);
    ipcRenderer.send('webview:video-url', url);
  }

  /**
   * Extract video URL from element
   */
  function getVideoUrl(video) {
    // Check for direct src
    if (video.src && video.src.trim()) {
      return video.src;
    }
    // Check <source> children
    const sources = video.querySelectorAll('source');
    for (const source of sources) {
      if (source.src && source.src.trim()) {
        return source.src;
      }
    }
    // Check currentSrc (set after load)
    if (video.currentSrc && video.currentSrc.trim()) {
      return video.currentSrc;
    }
    return null;
  }

  /**
   * Watch a single <video> element
   */
  function watchVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return;

    function sendCurrentUrl() {
      const url = getVideoUrl(video);
      if (url) reportVideoUrl(url);
    }

    // Check immediately
    sendCurrentUrl();

    // Watch for source changes
    video.addEventListener('loadedmetadata', sendCurrentUrl, { passive: true });
    video.addEventListener('loadstart', sendCurrentUrl, { passive: true });
  }

  // Scan existing videos
  const existingVideos = document.querySelectorAll('video');
  console.log(`[WEBVIEW] Found ${existingVideos.length} existing videos`);
  existingVideos.forEach(watchVideo);

  // Watch for dynamically added videos
  const videoObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLVideoElement) {
            console.log('[WEBVIEW] Detected dynamically added video element');
            watchVideo(node);
          } else if (node instanceof Element) {
            const videos = node.querySelectorAll('video');
            if (videos.length > 0) console.log(`[WEBVIEW] Found ${videos.length} videos in dynamic node`);
            videos.forEach(watchVideo);
          }
        }
      }
    }
  });

  videoObserver.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });
  console.log('[WEBVIEW] Video MutationObserver installed');
}

/* ============= AUDIO MONITORING ============= */
/*
 * Detects audio content via three complementary methods:
 *   1. <audio> element src/source scanning + MutationObserver
 *   2. <a href="*.mp3|*.wav|..."> link scanning (podcast pages, download links)
 *   3. Intercepts AudioContext / fetch() / XMLHttpRequest calls that load audio blobs
 *      (covers JS-based players like podcast widgets, Soundcloud embeds, etc.)
 */

const AUDIO_URLS_SEEN = new Set();
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|flac|aac|m4a|opus|weba|caf)(\?[^#]*)?$/i;

function installAudioObserver() {
  if (window.__audioObserverInstalled) {
    console.log('[WEBVIEW] Audio observer already installed');
    return;
  }
  window.__audioObserverInstalled = true;

  console.log('[WEBVIEW] Installing audio observer (v2 — element + links + XHR)...');

  /* ── Deduplicated reporter ── */
  function reportAudioUrl(url) {
    if (!url || typeof url !== 'string' || url.trim() === '') return;
    if (AUDIO_URLS_SEEN.has(url)) return;
    if (url.startsWith('blob:') || url.startsWith('data:')) return;
    if (!url.startsWith('http')) return;
    AUDIO_URLS_SEEN.add(url);
    console.log(`[WEBVIEW] Audio detected: ${url.substring(0, 80)}`);
    ipcRenderer.send('webview:audio-url', url);
  }

  /* ── Method 1: <audio> elements ── */
  function getAudioUrl(audio) {
    if (audio.src && audio.src.trim()) return audio.src;
    const sources = audio.querySelectorAll('source');
    for (const s of sources) {
      if (s.src && s.src.trim()) return s.src;
    }
    return audio.currentSrc || null;
  }

  function watchAudio(audio) {
    if (!(audio instanceof HTMLAudioElement)) return;
    const send = () => { const u = getAudioUrl(audio); if (u) reportAudioUrl(u); };
    send();
    audio.addEventListener('loadedmetadata', send, { passive: true });
    audio.addEventListener('loadstart',       send, { passive: true });
    audio.addEventListener('play',            send, { passive: true });
  }

  /* ── Method 2: <a> links pointing to audio files ── */
  function scanAudioLinks(root) {
    (root || document).querySelectorAll('a[href]').forEach(a => {
      if (AUDIO_EXT_RE.test(a.href)) reportAudioUrl(a.href);
    });
  }

  /* ── Method 3: Intercept fetch() for audio URLs ── */
  const _origFetch = window.fetch;
  window.fetch = function(resource, init) {
    try {
      const url = typeof resource === 'string' ? resource
        : resource instanceof Request ? resource.url : null;
      if (url && AUDIO_EXT_RE.test(url.split('?')[0])) reportAudioUrl(url);
    } catch (_) {}
    return _origFetch.apply(this, arguments);
  };

  /* ── Method 4: Intercept XMLHttpRequest for audio URLs ── */
  const _origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    try {
      if (typeof url === 'string' && AUDIO_EXT_RE.test(url.split('?')[0])) reportAudioUrl(url);
    } catch (_) {}
    return _origXhrOpen.apply(this, arguments);
  };

  /* ── Bootstrap ── */
  const existingAudio = document.querySelectorAll('audio');
  console.log(`[WEBVIEW] Found ${existingAudio.length} existing audio elements`);
  existingAudio.forEach(watchAudio);
  scanAudioLinks();

  const audioObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLAudioElement) {
          watchAudio(node);
        } else if (node instanceof Element) {
          node.querySelectorAll('audio').forEach(watchAudio);
          // Also scan new links
          if (AUDIO_EXT_RE.test((node.getAttribute && node.getAttribute('href')) || ''))
            reportAudioUrl(node.href);
          node.querySelectorAll && node.querySelectorAll('a[href]').forEach(a => {
            if (AUDIO_EXT_RE.test(a.href)) reportAudioUrl(a.href);
          });
        }
      }
    }
  });

  audioObserver.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });
  console.log('[WEBVIEW] Audio observer v2 installed');
}

/* ---- Bootstrap Video & Audio ---- */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    installVideoObserver();
    installAudioObserver();
  }, { once: true });
} else {
  installVideoObserver();
  installAudioObserver();
}

// Retry for lazy-loaded media
setTimeout(() => {
  installVideoObserver();
  installAudioObserver();
}, 1000);
setTimeout(() => {
  installVideoObserver();
  installAudioObserver();
}, 3000);

/* ============= CONTEXT SCAN (right-click / double-click to scan) ============= */
/*
 * Right-click on an image, video, or audio element → native "Scan with Entity X" menu.
 * Right-click while text is selected → same menu for the selected text.
 * Double-click on an image → immediate scan popup (no menu step).
 */

function installContextScanHandlers() {
  if (window.__contextScanInstalled) return;
  window.__contextScanInstalled = true;

  /* ── contextmenu handler ── */
  async function captureImageBase64(url) {
    try {
      const resp = await Promise.race([
        fetch(url, { mode: 'cors', credentials: 'omit' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
      ]);
      if (!resp.ok) return null;
      const buffer = await resp.arrayBuffer();
      const arr = new Uint8Array(buffer);
      let binary = '';
      const CHUNK = 8192;
      for (let i = 0; i < arr.length; i += CHUNK) {
        binary += String.fromCharCode(...arr.slice(i, i + CHUNK));
      }
      return btoa(binary);
    } catch (_) {
      return null;
    }
  }

  document.addEventListener('contextmenu', (e) => {
    const target = e.target;
    let payload = null;

    if (target instanceof HTMLImageElement) {
      const url = target.currentSrc || target.src;
      if (url && url.startsWith('http')) {
        e.preventDefault();
        captureImageBase64(url).then(imageBase64 => {
          ipcRenderer.send('webview:context-scan-request', { type: 'image', url, imageBase64 });
        });
        return;
      }
    } else if (target instanceof HTMLVideoElement) {
      // currentSrc is often blob: on YouTube/streaming sites
      const rawUrl = target.currentSrc || target.src || '';
      let videoUrl = rawUrl.startsWith('http') ? rawUrl : null;

      if (!videoUrl) {
        // 1. Walk up DOM to find nearest <a> with a watch/video URL
        let el = target;
        while (el && el !== document.body) {
          if (el.tagName === 'A' && el.href) {
            const href = el.href;
            if (href.includes('watch?v=') || href.includes('/video/') || href.includes('/shorts/') || href.includes('/reel/')) {
              videoUrl = href;
              break;
            }
          }
          el = el.parentElement;
        }
      }

      if (!videoUrl) {
        // 2. Look for a nearby <a> sibling/cousin with a watch URL (YouTube thumbnail links)
        const container = target.closest('ytd-thumbnail, [data-video-id], article, .video-item, .media-item, li') || target.parentElement;
        if (container) {
          const link = container.querySelector('a[href*="watch?v="], a[href*="/video/"], a[href*="/shorts/"], a[href*="/reel/"]');
          if (link) videoUrl = link.href;
        }
      }

      if (!videoUrl) {
        // 3. If the page itself is a video watch page, use it
        const pageUrl = window.location.href;
        if (pageUrl.includes('watch?v=') || pageUrl.includes('/video/') || pageUrl.includes('/shorts/') || pageUrl.includes('/reel/')) {
          videoUrl = pageUrl;
        }
      }

      if (!videoUrl) {
        // 4. Last resort: use data-video-id attribute on container to construct URL
        const container = target.closest('[data-video-id]');
        if (container && container.dataset.videoId) {
          videoUrl = `https://www.youtube.com/watch?v=${container.dataset.videoId}`;
        }
      }

      if (videoUrl && videoUrl.startsWith('http')) {
        payload = { type: 'video', url: videoUrl, page_url: window.location.href, title: document.title };
      }
    } else if (target instanceof HTMLAudioElement) {
      const url = target.currentSrc || target.src;
      if (url && url.startsWith('http')) {
        payload = { type: 'audio', url };
      }
    } else {
      /* Text selection scan */
      const selected = window.getSelection?.()?.toString?.()?.trim();
      if (selected && selected.length > 20) {
        payload = { type: 'text', text: selected, title: document.title, url: window.location.href };
      }
    }

    if (payload) {
      e.preventDefault();
      ipcRenderer.send('webview:context-scan-request', payload);
    }
  }, true);

  /* ── double-click on image → immediate popup (no menu) ── */
  document.addEventListener('dblclick', (e) => {
    const target = e.target;
    if (target instanceof HTMLImageElement) {
      const url = target.currentSrc || target.src;
      if (url && url.startsWith('http')) {
        captureImageBase64(url).then(imageBase64 => {
          ipcRenderer.send('webview:context-scan-request', { type: 'image', url, imageBase64, immediate: true });
        });
      }
    }
  }, true);

  console.log('[WEBVIEW] Context scan handlers installed');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installContextScanHandlers, { once: true });
} else {
  installContextScanHandlers();
}