var KEY = "gwg:token";
var input = document.getElementById("token");
var status = document.getElementById("status");

function normalize(value) {
  return String(value || "").replace(/^Bearer\s+/i, "").trim();
}

chrome.storage.local.get(KEY, function (data) {
  input.value = (data && data[KEY]) || "";
});

document.getElementById("form").addEventListener("submit", function (event) {
  event.preventDefault();
  var token = normalize(input.value);
  input.value = token;
  if (!token) chrome.storage.local.remove(KEY);
  else chrome.storage.local.set((function () { var box = {}; box[KEY] = token; return box; })());
  status.textContent = token ? "Saved. Reload the GitHub tab to use it." : "Token removed.";
});

document.getElementById("clear").addEventListener("click", function () {
  input.value = "";
  chrome.storage.local.remove(KEY);
  status.textContent = "Token removed.";
});
