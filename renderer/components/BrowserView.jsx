import { useEffect, useRef, useState } from 'react'

export default function BrowserView({ url }) {
  const webviewRef = useRef(null)
  const [preloadPath, setPreloadPath] = useState(null)

  // Get the correct preload path from main process before rendering webview
  useEffect(() => {
    if (window.entityX?.getWebviewPreloadPath) {
      window.entityX.getWebviewPreloadPath().then((p) => {
        console.log('[BrowserView] Preload path:', p)
        setPreloadPath(p)
      })
    } else {
      setPreloadPath('') // fallback — session interceptor still works
    }
  }, [])

  useEffect(() => {
    if (webviewRef.current && url) {
      webviewRef.current.src = url
    }
  }, [url])

  // Don't render webview until we have the preload path (avoids race condition)
  if (preloadPath === null) {
    return <div className="flex-1 bg-gray-900" />
  }

  return (
    <div className="flex-1 bg-white overflow-hidden relative">
      <webview
        ref={webviewRef}
        src={url}
        className="w-full h-full"
        partition="persist:browser"
        preload={preloadPath || undefined}
        allowpopups="true"
      />
    </div>
  )
}
