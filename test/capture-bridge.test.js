import assert from "node:assert/strict";
import test from "node:test";

import { installSteamCaptureBridge } from "../src/capture-bridge.js";

const events = {
  failure: "failure",
  inventory: "inventory",
  validate: "validate",
  validateEnd: "validate-end",
  validateStart: "validate-start",
};

class FakeCustomEvent {
  constructor(type, options) {
    return { detail: options.detail, type };
  }
}

class FakeRequest {
  constructor(url) {
    this.url = url;
  }
}

function pageWindow() {
  class XmlHttpRequest {
    listeners = new Map();
    response = null;
    responseJSON = undefined;
    responseText = "";
    responseType = "";
    status = 0;

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    abort() {
      this.listeners.get("abort")?.();
    }

    open(_method, url) {
      this.url = url;
    }

    send() {}

    respond(status, value) {
      this.status = status;
      this.responseText = JSON.stringify(value);
      this.listeners.get("load")?.();
    }
  }

  const dispatched = [];
  const documentListeners = new Map();
  const responders = [];
  const page = {
    Ajax: {
      Responders: {
        register(responder) {
          responders.push(responder);
        },
      },
    },
    CustomEvent: FakeCustomEvent,
    Request: FakeRequest,
    XMLHttpRequest: XmlHttpRequest,
    dispatchEvent(event) {
      dispatched.push(event);
    },
    document: {
      addEventListener(type, listener) {
        documentListeners.set(type, listener);
      },
    },
    fetch: async () => {
      throw new Error("Unexpected fetch");
    },
    location: {
      href: "https://steamcommunity.com/profiles/76561198329819384/inventory/",
    },
  };
  return { dispatched, documentListeners, page, responders };
}

const validateResponse = {
  gift_name: "Unknown package 2574",
  message: "…",
  owned: true,
  packageid: "2574",
  success: 1,
};

test("captures Steam's Prototype validateunpack completion contract", () => {
  const fixture = pageWindow();
  installSteamCaptureBridge(fixture.page, events);

  assert.equal(fixture.responders.length, 1);
  fixture.responders[0].onCreate({
    url: "https://steamcommunity.com/gifts/1600336606994018551/validateunpack",
  });
  fixture.responders[0].onComplete(
    {
      url: "https://steamcommunity.com/gifts/1600336606994018551/validateunpack",
    },
    { responseJSON: validateResponse, status: 200 },
  );

  assert.deepEqual(fixture.dispatched, [
    {
      detail: { assetId: "1600336606994018551" },
      type: "validate-start",
    },
    {
      detail: {
        assetId: "1600336606994018551",
        response: validateResponse,
      },
      type: "validate",
    },
  ]);
});

test("registers with Prototype when it loads after document-start", () => {
  const fixture = pageWindow();
  delete fixture.page.Ajax;
  installSteamCaptureBridge(fixture.page, events);

  const responders = [];
  fixture.page.Ajax = {
    Responders: {
      register(responder) {
        responders.push(responder);
      },
    },
  };
  fixture.documentListeners.get("DOMContentLoaded")();

  assert.equal(responders.length, 1);
});

test("captures validateunpack through XMLHttpRequest without changing it", () => {
  const fixture = pageWindow();
  delete fixture.page.Ajax;
  installSteamCaptureBridge(fixture.page, events);

  const request = new fixture.page.XMLHttpRequest();
  request.open(
    "GET",
    "https://steamcommunity.com/gifts/1600336606994018551/validateunpack",
  );
  request.send();
  request.respond(200, { ...validateResponse, gift_name: "" });

  assert.deepEqual(fixture.dispatched, [
    {
      detail: { assetId: "1600336606994018551" },
      type: "validate-start",
    },
    {
      detail: {
        assetId: "1600336606994018551",
        response: { ...validateResponse, gift_name: "" },
      },
      type: "validate",
    },
  ]);
});

test("deduplicates a response seen by Prototype and XMLHttpRequest", () => {
  const fixture = pageWindow();
  installSteamCaptureBridge(fixture.page, events);

  const request = new fixture.page.XMLHttpRequest();
  const url = "/gifts/1600336606994018551/validateunpack";
  request.open("GET", url);
  request.send();
  request.status = 200;
  request.responseJSON = validateResponse;

  fixture.responders[0].onComplete({ url }, request);
  request.listeners.get("load")();

  assert.equal(
    fixture.dispatched.filter(({ type }) => type === "validate").length,
    1,
  );
});

test("does not turn an aborted XHR into a later Prototype failure", () => {
  const fixture = pageWindow();
  installSteamCaptureBridge(fixture.page, events);

  const request = new fixture.page.XMLHttpRequest();
  const url = "/gifts/1600336606994018551/validateunpack";
  request.open("GET", url);
  request.send();
  request.abort();
  fixture.responders[0].onComplete({ url }, request);

  assert.deepEqual(fixture.dispatched, [
    {
      detail: { assetId: "1600336606994018551" },
      type: "validate-start",
    },
    {
      detail: { assetId: "1600336606994018551" },
      type: "validate-end",
    },
  ]);
});

test("continues capturing inventory responses through fetch", async () => {
  const fixture = pageWindow();
  const response = {
    assets: [
      {
        appid: 753,
        assetid: "1600336606994018551",
        classid: "6131612525",
        contextid: "1",
      },
    ],
  };
  fixture.page.fetch = async () => ({
    clone: () => ({ json: async () => response }),
    ok: true,
    status: 200,
  });
  installSteamCaptureBridge(fixture.page, events);

  await fixture.page.fetch(
    "https://steamcommunity.com/inventory/76561198329819384/753/1",
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(fixture.dispatched[0], {
    detail: {
      assets: response.assets,
      steamId64: "76561198329819384",
    },
    type: "inventory",
  });
});

test("treats an extension's cancelled fetch as completion, not failure", async () => {
  const fixture = pageWindow();
  const abort = new Error("cancelled");
  abort.name = "AbortError";
  fixture.page.fetch = async () => {
    throw abort;
  };
  installSteamCaptureBridge(fixture.page, events);

  await assert.rejects(
    fixture.page.fetch("/gifts/1600336606994018551/validateunpack"),
    abort,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(fixture.dispatched, [
    {
      detail: { assetId: "1600336606994018551" },
      type: "validate-start",
    },
    {
      detail: { assetId: "1600336606994018551" },
      type: "validate-end",
    },
  ]);
});

test("reports matched Steam capture failures instead of hiding them", () => {
  const fixture = pageWindow();
  installSteamCaptureBridge(fixture.page, events);

  fixture.responders[0].onComplete(
    { url: "/gifts/1600336606994018551/validateunpack" },
    { responseText: "not json", status: 200 },
  );

  assert.deepEqual(fixture.dispatched, [
    {
      detail: {
        assetId: "1600336606994018551",
        kind: "validate",
        message: "Steam returned unreadable JSON",
        status: null,
      },
      type: "failure",
    },
  ]);
});
