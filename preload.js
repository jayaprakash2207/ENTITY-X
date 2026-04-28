/**
 * RENDERER PRELOAD
 * 
 * This script runs in the renderer context (main window) and exposes
 * safe APIs for:
 * - Receiving image analysis results from the main process
 * - Forwarding those results to the sidebar iframe
 */

const { contextBridge, ipcRenderer } = require('electron');

console.log('[RENDERER-PRELOAD] Preload script executing...');

contextBridge.exposeInMainWorld('imageMonitor', {
  /**
   * Register a callback to receive image analysis results from main process
   */
  onAnalysis: (callback) => {
    console.log('[RENDERER-PRELOAD] onAnalysis called with callback');
    if (typeof callback !== 'function') {
      console.error('[RENDERER-PRELOAD] callback is not a function!');
      return () => {};
    }

    const listener = (_event, data) => {
      console.log('[RENDERER-PRELOAD] IPC event received from main: image-monitor:analysis');
      callback(data);
    };

    ipcRenderer.on('image-monitor:analysis', listener);
    console.log('[RENDERER-PRELOAD] listener registered for image-monitor:analysis');

    /* Return unsubscribe function */
    return () => {
      ipcRenderer.removeListener('image-monitor:analysis', listener);
    };
  }
});

contextBridge.exposeInMainWorld('textMonitor', {
  /**
   * Register a callback to receive text/article analysis results from main process
   */
  onAnalysis: (callback) => {
    console.log('[RENDERER-PRELOAD] textMonitor.onAnalysis called');
    if (typeof callback !== 'function') {
      console.error('[RENDERER-PRELOAD] callback is not a function!');
      return () => {};
    }

    const listener = (_event, data) => {
      console.log('[RENDERER-PRELOAD] IPC event received: text-monitor:analysis');
      callback(data);
    };

    ipcRenderer.on('text-monitor:analysis', listener);
    console.log('[RENDERER-PRELOAD] listener registered for text-monitor:analysis');

    return () => {
      ipcRenderer.removeListener('text-monitor:analysis', listener);
    };
  }
});

contextBridge.exposeInMainWorld('videoMonitor', {
  /**
   * Register a callback to receive video analysis results from main process
   */
  onAnalysis: (callback) => {
    console.log('[RENDERER-PRELOAD] videoMonitor.onAnalysis called');
    if (typeof callback !== 'function') {
      console.error('[RENDERER-PRELOAD] callback is not a function!');
      return () => {};
    }

    const listener = (_event, data) => {
      console.log('[RENDERER-PRELOAD] IPC event received: video-monitor:analysis');
      callback(data);
    };

    ipcRenderer.on('video-monitor:analysis', listener);
    console.log('[RENDERER-PRELOAD] listener registered for video-monitor:analysis');

    return () => {
      ipcRenderer.removeListener('video-monitor:analysis', listener);
    };
  }
});

contextBridge.exposeInMainWorld('audioMonitor', {
  /**
   * Register a callback to receive audio analysis results from main process
   */
  onAnalysis: (callback) => {
    console.log('[RENDERER-PRELOAD] audioMonitor.onAnalysis called');
    if (typeof callback !== 'function') {
      console.error('[RENDERER-PRELOAD] callback is not a function!');
      return () => {};
    }

    const listener = (_event, data) => {
      console.log('[RENDERER-PRELOAD] IPC event received: audio-monitor:analysis');
      callback(data);
    };

    ipcRenderer.on('audio-monitor:analysis', listener);
    console.log('[RENDERER-PRELOAD] listener registered for audio-monitor:analysis');

    return () => {
      ipcRenderer.removeListener('audio-monitor:analysis', listener);
    };
  }
});

contextBridge.exposeInMainWorld('entityView', {
  /**
   * Fetch detailed entity information (in-memory from main process)
   */
  getDetails: async (entityId) => {
    console.log(`[RENDERER-PRELOAD] getDetails for ${entityId}`);
    return await ipcRenderer.invoke('entity:details', entityId);
  }
});

contextBridge.exposeInMainWorld('entityX', {
  analyzeUrl:    (url)             => ipcRenderer.invoke('analyze:manual-url',  url),
  analyzeText:   ({ text, title }) => ipcRenderer.invoke('analyze:manual-text', { text, title }),
  scanVideo:          (url)  => ipcRenderer.invoke('analyze:manual-video', url),
  scanAudio:          (url)  => ipcRenderer.invoke('analyze:manual-audio', url),
  scanVideoWithAudio: (url)  => ipcRenderer.invoke('analyze:manual-video-with-audio', url),
  resetTrust:    ()               => ipcRenderer.invoke('trust:reset'),
  getHistory:    (filters)         => ipcRenderer.invoke('history:get', filters || {}),
  generateLegal: (payload)         => ipcRenderer.invoke('legal:generate-complaint', payload || {}),
  aiChat:        (messages, ctx)   => ipcRenderer.invoke('ai:chat', { messages, context: ctx || null }),
  browserAgent:  (messages, ctx)   => ipcRenderer.invoke('browser:ai-agent', { messages, pageContext: ctx || {} }),
  exportPdf:           (payload)         => ipcRenderer.invoke('evidence:export-pdf', payload || {}),
  queryDb:             (opts)            => ipcRenderer.invoke('db:query', opts || {}),
  legalChatQuery:      (payload)         => ipcRenderer.invoke('legal-chat:query',   payload || {}),
  legalChatHistory:    (entity_id)       => ipcRenderer.invoke('legal-chat:history', { entity_id: entity_id || '' }),

  /* Webview bridge — called by index.html's ipc-message handler to
   * forward image URLs and text payloads from the webview to main process */
  sendImageUrl:    (url)     => ipcRenderer.send('image-monitor:url',    url),
  sendTextContent: (payload) => ipcRenderer.send('text-monitor:article', payload),
  sendNavigation:  (url)     => ipcRenderer.send('webview:navigated',    url),
  notifyNavigated: (url)     => ipcRenderer.send('webview:navigated',    url),

  /* Returns the absolute file:// URL for the webview preload script,
   * resolved dynamically by the main process so it works in any location */
  getWebviewPreloadPath: ()  => ipcRenderer.invoke('get:webview-preload-path'),

  /* Context-scan popup: main process sends this when user picks "Scan with Entity X"
   * from the right-click menu (or double-clicks an image) in the webview */
  onScanPopupOpen: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('scan:popup:open', listener);
    return () => ipcRenderer.removeListener('scan:popup:open', listener);
  },

  /* Rich content enrichment — calls /api/enrich on the Python backend
   * to get EXIF/colors (image), video metadata, NLP (text), transcript (audio) */
  enrichContent: (type, params) => ipcRenderer.invoke('analyze:enrich', { type, ...params }),

  domainReputation: ()           => ipcRenderer.invoke('db:domain-reputation'),
  alertRulesList:   ()           => ipcRenderer.invoke('alert-rules:list'),
  alertRulesSave:   (rule)       => ipcRenderer.invoke('alert-rules:save', rule),
  alertRulesDelete: (ruleId)     => ipcRenderer.invoke('alert-rules:delete', ruleId),
  onAlertRuleTriggered: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on('alert-rules:triggered', listener);
    return () => ipcRenderer.removeListener('alert-rules:triggered', listener);
  },

  // Cases
  casesCreate:      (data)                    => ipcRenderer.invoke('cases:create', data),
  casesList:        (workspaceId)             => ipcRenderer.invoke('cases:list', workspaceId || ''),
  casesGet:         (id)                      => ipcRenderer.invoke('cases:get', id),
  casesUpdate:      (id, data)                => ipcRenderer.invoke('cases:update', { id, ...data }),
  casesDelete:      (id)                      => ipcRenderer.invoke('cases:delete', id),
  casesAddEvidence: (caseId, ev)              => ipcRenderer.invoke('cases:add-evidence', { caseId, ...ev }),
  casesExport:      (id)                      => ipcRenderer.invoke('cases:export', id),

  // Feedback
  feedbackSubmit:   (payload)                 => ipcRenderer.invoke('feedback:submit', payload),

  // Community DB
  communityCheck:   (hash, type)              => ipcRenderer.invoke('community:check', { hash, content_type: type }),
  communityReport:  (hash, type, risk, domain) => ipcRenderer.invoke('community:report', { hash, content_type: type, risk_level: risk, source_domain: domain || '' }),
  communityStats:   ()                        => ipcRenderer.invoke('community:stats'),

  // Social Scanner
  socialList:       ()                        => ipcRenderer.invoke('social:list'),
  socialAdd:        (platform, handle, rssUrl) => ipcRenderer.invoke('social:add', { platform, handle, rss_url: rssUrl || '' }),
  socialRemove:     (id)                      => ipcRenderer.invoke('social:remove', id),
  socialScan:       ()                        => ipcRenderer.invoke('social:scan'),

  // Creator Shield
  creatorList:      ()                        => ipcRenderer.invoke('creator:list'),
  creatorRegister:  (profile)                 => ipcRenderer.invoke('creator:register', profile),
  creatorDelete:    (id)                      => ipcRenderer.invoke('creator:delete', id),

  // Threat Map
  threatMapData:    ()                        => ipcRenderer.invoke('threat-map:data'),

  // Trust Badge
  badgeGenerate:    (url)                     => ipcRenderer.invoke('badge:generate', url),

  // Newsroom
  newsroomWorkspaces: ()                      => ipcRenderer.invoke('newsroom:workspaces'),
  newsroomCreate:   (data)                    => ipcRenderer.invoke('newsroom:create', data),
  newsroomDelete:   (id)                      => ipcRenderer.invoke('newsroom:delete', id),

  // Web News Search + AI Verdict
  webSearch: (payload) => ipcRenderer.invoke('web:search', payload || {}),
});

contextBridge.exposeInMainWorld('systemBus', {
  /** Fires if the Python backend process fails to spawn (from our main.js fix) */
  onSpawnError: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on('backend:spawn-error', listener);
    return () => ipcRenderer.removeListener('backend:spawn-error', listener);
  },
  /** Fires if the Electron-side SQLite DB failed to init (from our db.js fix) */
  onDbInitError: (cb) => {
    const listener = (_, data) => cb(data);
    ipcRenderer.on('db:init-error', listener);
    return () => ipcRenderer.removeListener('db:init-error', listener);
  },
});

contextBridge.exposeInMainWorld('backendBus', {
  onReady: (cb) => {
    let fired = false;
    const fire = () => { if (!fired) { fired = true; cb(); } };

    // Primary: listen for the IPC signal from main process
    const listener = () => fire();
    ipcRenderer.on('backend:ready', listener);

    // Fallback: quietly poll without spamming the console
    // (handles the case where backend was already up before this listener registered)
    const poll = async () => {
      for (let i = 0; i < 60 && !fired; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const r = await fetch('http://127.0.0.1:8000/api/health', { signal: AbortSignal.timeout(800) });
          if (r.ok) { fire(); return; }
        } catch (_) { /* still starting — keep waiting */ }
      }
    };
    // Start polling after a short delay so the first attempt is never at t=0
    setTimeout(poll, 1500);

    return () => ipcRenderer.removeListener('backend:ready', listener);
  }
});

console.log('[RENDERER-PRELOAD] All APIs exposed: imageMonitor, textMonitor, videoMonitor, audioMonitor, entityView, entityX');