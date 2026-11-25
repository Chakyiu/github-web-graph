chrome.action.onClicked.addListener(function () {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (!message || message.type !== "gwg:fetch") return;
  var url = message.url;
  if (typeof url !== "string" || url.indexOf("https://api.github.com/") !== 0) {
    sendResponse({ ok: false, status: 0, error: "blocked" });
    return;
  }
  var headers = { Accept: "application/vnd.github+json" };
  var incoming = message.headers || {};
  if (incoming.Accept) headers.Accept = incoming.Accept;
  if (incoming["X-GitHub-Api-Version"]) headers["X-GitHub-Api-Version"] = incoming["X-GitHub-Api-Version"];
  if (typeof incoming.Authorization === "string" && incoming.Authorization.indexOf("Bearer ") === 0) {
    headers.Authorization = incoming.Authorization;
  }
  fetch(url, { method: "GET", headers: headers, credentials: "omit" })
    .then(function (res) {
      return res.text().then(function (text) {
        var out = {};
        ["x-ratelimit-remaining", "x-ratelimit-reset", "link"].forEach(function (name) {
          var value = res.headers.get(name);
          if (value) out[name] = value;
        });
        sendResponse({ ok: res.ok, status: res.status, text: text, headers: out });
      });
    })
    .catch(function (err) {
      sendResponse({ ok: false, status: 0, error: String(err && err.message ? err.message : err) });
    });
  return true;
});
