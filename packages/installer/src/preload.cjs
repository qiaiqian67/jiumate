'use strict'
/**
 * The only surface the renderer gets. Every capability is an explicit, named channel — the
 * installer UI runs no Node and cannot reach the filesystem on its own.
 */
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("installer", {
  info: () => ipcRenderer.invoke("installer:info"),
  space: (target) => ipcRenderer.invoke("installer:space", target),
  browse: () => ipcRenderer.invoke("installer:browse"),
  start: (opts) => ipcRenderer.invoke("installer:start", opts),
  save: (answers) => ipcRenderer.invoke("installer:save", answers),
  testModel: (opts) => ipcRenderer.invoke("installer:test-model", opts),
  launch: (target) => ipcRenderer.invoke("installer:launch", target),
  catalog: () => ipcRenderer.invoke("installer:catalog"),
  themes: () => ipcRenderer.invoke("installer:themes"),
  /**
   * The project's icon as a data URL. Passed as a data URL rather than a file:// path because the
   * renderer is served from disk under a CSP of `default-src 'none'`; resolving the path in the page
   * would need `img-src file:`, which is a wider grant than showing one known image. The bytes are
   * read in the main process because a preload with contextIsolation has no filesystem access.
   */
  icon: () => ipcRenderer.invoke("installer:icon").then((b64) => (b64 ? `data:image/png;base64,${b64}` : null)),
  uninstall: () => ipcRenderer.invoke("installer:uninstall"),
  uninstallSize: () => ipcRenderer.invoke("installer:uninstallSize"),
  uninstallLang: () => ipcRenderer.invoke("installer:uninstallLang"),
  dataSize: () => ipcRenderer.invoke("installer:dataSize"),
  finalizeUninstall: () => ipcRenderer.invoke("installer:finalizeUninstall"),
  minimize: () => ipcRenderer.invoke("installer:minimize"),
  close: () => ipcRenderer.invoke("installer:close"),
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload)
    ipcRenderer.on("installer:progress", handler)
    return () => ipcRenderer.removeListener("installer:progress", handler)
  },
})
