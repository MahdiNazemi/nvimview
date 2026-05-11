(function () {
  function zoomFactorFromPercent(zoomPercent) {
    const value = Number(zoomPercent);
    return Number.isFinite(value) && value > 0 ? value / 100 : 1;
  }

  async function currentTabId(browserApi) {
    if (!browserApi?.tabs?.getCurrent) {
      return null;
    }
    const tab = await browserApi.tabs.getCurrent();
    return typeof tab?.id === "number" ? tab.id : null;
  }

  async function enforceViewerZoom({ browserApi, zoomPercent = 100 } = {}) {
    if (!browserApi?.tabs?.setZoom) {
      return null;
    }
    const tabId = await currentTabId(browserApi);
    if (tabId === null) {
      return null;
    }
    // Firefox has rejected setZoomSettings({mode: "automatic", scope: "per-tab"})
    // in live testing. Keep viewer zoom to setZoom(), and let non-viewer pages
    // call setZoom(0) so they return to the user's browser default.
    await browserApi.tabs.setZoom(tabId, zoomFactorFromPercent(zoomPercent));
    return tabId;
  }

  async function resetCurrentTabZoomToDefault({ browserApi } = {}) {
    if (!browserApi?.tabs?.setZoom) {
      return null;
    }
    const tabId = await currentTabId(browserApi);
    if (tabId === null) {
      return null;
    }
    await browserApi.tabs.setZoom(tabId, 0);
    return tabId;
  }

  globalThis.NvimView = {
    ...(globalThis.NvimView || {}),
    enforceViewerZoom,
    resetCurrentTabZoomToDefault,
    zoomFactorFromPercent,
  };
})();
