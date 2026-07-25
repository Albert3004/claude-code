// Shared Property Inspector helper for the Claude Code Controls plugin.
// Auto-binds any element with a [data-setting] attribute to the action's
// persisted settings and saves back to Stream Deck on change.
(function () {
  let ws = null;
  let uuid = null;
  const SDPI = { settings: {}, onReady: null };
  window.SDPI = SDPI;

  function save() {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ event: "setSettings", context: uuid, payload: SDPI.settings }));
  }
  SDPI.save = save;

  function bind() {
    document.querySelectorAll("[data-setting]").forEach((el) => {
      const key = el.getAttribute("data-setting");
      if (SDPI.settings[key] !== undefined && SDPI.settings[key] !== null) {
        el.value = SDPI.settings[key];
      } else if (el.getAttribute("data-default") !== null) {
        SDPI.settings[key] = el.getAttribute("data-default");
        el.value = SDPI.settings[key];
      }
      const evt = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evt, () => {
        SDPI.settings[key] = el.value;
        save();
      });
    });
    if (typeof SDPI.onReady === "function") SDPI.onReady();
  }

  window.connectElgatoStreamDeckSocket = function (port, inUUID, registerEvent, info, actionInfo) {
    uuid = inUUID;
    try {
      SDPI.settings = JSON.parse(actionInfo).payload.settings || {};
    } catch (_) {
      SDPI.settings = {};
    }
    ws = new WebSocket("ws://127.0.0.1:" + port);
    ws.onopen = function () {
      ws.send(JSON.stringify({ event: registerEvent, uuid: inUUID }));
      bind();
    };
  };
})();
