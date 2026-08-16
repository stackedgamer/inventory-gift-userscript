import { classifySteamRequestUrl } from "./core.js";

function responseJson(transport) {
  if (transport.responseType === "json" && transport.response !== null) {
    return transport.response;
  }
  if (transport.responseJSON !== undefined) return transport.responseJSON;
  return JSON.parse(String(transport.responseText));
}

export function installSteamCaptureBridge(pageWindow, eventNames) {
  const handledTransports = new WeakSet();
  const xhrRequestKey = Symbol("inventoryGiftRequest");

  const dispatch = (eventName, detail) => {
    try {
      pageWindow.dispatchEvent(
        new pageWindow.CustomEvent(eventName, { detail }),
      );
    } catch (error) {
      pageWindow.console?.warn?.(
        "[Inventory.gift] Could not deliver a Steam capture event",
        error,
      );
    }
  };

  const reportFailure = (request, message, status = null) => {
    dispatch(eventNames.failure, {
      assetId: request.kind === "validate" ? request.assetId : null,
      kind: request.kind,
      message,
      status,
    });
  };

  const reportRequestStart = (request) => {
    if (request.kind === "validate") {
      dispatch(eventNames.validateStart, { assetId: request.assetId });
    }
  };

  const reportRequestEnd = (request) => {
    if (request.kind === "validate") {
      dispatch(eventNames.validateEnd, { assetId: request.assetId });
    }
  };

  const emitResponse = (request, value) => {
    if (request.kind === "inventory") {
      if (
        value !== null &&
        typeof value === "object" &&
        Array.isArray(value.assets)
      ) {
        dispatch(eventNames.inventory, {
          assets: value.assets.map((candidate) => ({
            appid: candidate?.appid,
            assetid: candidate?.assetid,
            classid: candidate?.classid,
            contextid: candidate?.contextid,
          })),
          steamId64: request.steamId64,
        });
      } else {
        reportFailure(
          request,
          "Steam returned an invalid gift inventory response",
        );
      }
      return;
    }

    dispatch(eventNames.validate, {
      assetId: request.assetId,
      response: value,
    });
  };

  const captureTransport = (request, transport) => {
    if (handledTransports.has(transport)) return;
    handledTransports.add(transport);

    const status = Number(transport.status);
    if (!Number.isFinite(status) || status < 200 || status >= 300) {
      reportFailure(
        request,
        "Steam request failed",
        Number.isFinite(status) ? status : null,
      );
      return;
    }

    try {
      emitResponse(request, responseJson(transport));
    } catch {
      reportFailure(request, "Steam returned unreadable JSON");
    }
  };

  const originalFetch = pageWindow.fetch;
  pageWindow.fetch = function inventoryGiftFetch(input) {
    const result = originalFetch.apply(this, arguments);
    const requestUrl = input instanceof pageWindow.Request ? input.url : input;
    const request = classifySteamRequestUrl(
      String(requestUrl),
      pageWindow.location.href,
    );

    if (request !== null) {
      reportRequestStart(request);
      void result
        .then(async (response) => {
          if (!response.ok) {
            reportFailure(request, "Steam request failed", response.status);
            return;
          }
          emitResponse(request, await response.clone().json());
        })
        .catch((error) => {
          if (error?.name === "AbortError") {
            reportRequestEnd(request);
          } else {
            reportFailure(request, "Steam returned unreadable JSON");
          }
        });
    }

    return result;
  };

  const originalOpen = pageWindow.XMLHttpRequest.prototype.open;
  pageWindow.XMLHttpRequest.prototype.open = function inventoryGiftOpen(
    method,
    url,
  ) {
    const result = originalOpen.apply(this, arguments);
    this[xhrRequestKey] = classifySteamRequestUrl(
      String(url),
      pageWindow.location.href,
    );
    return result;
  };

  const originalSend = pageWindow.XMLHttpRequest.prototype.send;
  pageWindow.XMLHttpRequest.prototype.send = function inventoryGiftSend() {
    const request = this[xhrRequestKey];
    if (request !== null && request !== undefined) {
      reportRequestStart(request);
      this.addEventListener("load", () => captureTransport(request, this), {
        once: true,
      });
      this.addEventListener(
        "abort",
        () => {
          handledTransports.add(this);
          reportRequestEnd(request);
        },
        { once: true },
      );
    }
    return originalSend.apply(this, arguments);
  };

  let prototypeResponderInstalled = false;
  const installPrototypeResponder = () => {
    if (prototypeResponderInstalled) return;
    const responders = pageWindow.Ajax?.Responders;
    if (typeof responders?.register !== "function") return;

    responders.register({
      onCreate(request) {
        const capturedRequest = classifySteamRequestUrl(
          String(request?.url),
          pageWindow.location.href,
        );
        if (capturedRequest !== null) reportRequestStart(capturedRequest);
      },
      onComplete(request, transport) {
        const capturedRequest = classifySteamRequestUrl(
          String(request?.url),
          pageWindow.location.href,
        );
        if (capturedRequest !== null) {
          captureTransport(capturedRequest, transport);
        }
      },
    });
    prototypeResponderInstalled = true;
  };

  installPrototypeResponder();
  pageWindow.document.addEventListener(
    "DOMContentLoaded",
    installPrototypeResponder,
    { once: true },
  );
}
