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
  getHistory:    (filters)         => ipcRenderer.invoke('history:get', filters || {}),
  generateLegal: (payload)         => ipcRenderer.invoke('legal:generate-complaint', payload || {}),
  aiChat:        (messages, ctx)   => ipcRenderer.invoke('ai:chat', { messages, context: ctx || null }),
  exportPdf:           (payload)         => ipcRenderer.invoke('evidence:export-pdf', payload || {}),
  queryDb:             (opts)            => ipcRenderer.invoke('db:query', opts || {}),
  legalChatQuery:      (payload)         => ipcRenderer.invoke('legal-chat:query',   payload || {}),
  legalChatHistory:    (entity_id)       => ipcRenderer.invoke('legal-chat:history', { entity_id: entity_id || '' }),

  /* Webview bridge — called by index.html's ipc-message handler to
   * forward image URLs and text payloads from the webview to main process */
  sendImageUrl:    (url)     => ipcRenderer.send('image-monitor:url',    url),
  sendTextContent: (payload) => ipcRenderer.send('text-monitor:article', payload),
  sendNavigation:  (url)     => ipcRenderer.send('webview:navigated',    url)
});

console.log('[RENDERER-PRELOAD] All APIs exposed: imageMonitor, textMonitor, entityView, entityX');