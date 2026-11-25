/* Pure graph-page helpers. No DOM and no network. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GWGModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var RESERVED = {
    settings: 1, notifications: 1, explore: 1, topics: 1, marketplace: 1,
    orgs: 1, login: 1, signup: 1, pulls: 1, issues: 1, codespaces: 1, new: 1,
    organizations: 1, sponsors: 1, features: 1, pricing: 1, about: 1,
    security: 1, "customer-stories": 1, readme: 1, apps: 1, collections: 1,
    events: 1, trending: 1, search: 1, contact: 1, enterprise: 1, account: 1,
    sessions: 1, org: 1, users: 1, dashboard: 1, watching: 1, stars: 1,
    logout: 1, "favicon.ico": 1
  };

  function parseRepoPath(pathname) {
    var parts = String(pathname || "").split("/").filter(Boolean).map(function (part) {
      try { return decodeURIComponent(part); } catch (err) { return part; }
    });
    if (parts.length < 2 || RESERVED[parts[0]]) return null;
    var owner = parts[0];
    var repo = parts[1];
    if (parts.length === 2) return { owner: owner, repo: repo, refFromPath: null, code: true };
    if (parts[2] === "tree" && parts.length >= 4) {
      return { owner: owner, repo: repo, refFromPath: parts.slice(3).join("/"), code: true };
    }
    return { owner: owner, repo: repo, refFromPath: null, code: false };
  }

  function readRef(button, pathRef) {
    if (button) {
      var label = button.querySelector && button.querySelector("[class*='RefSelectorText']");
      var labelText = label && String(label.textContent || "").trim();
      if (labelText) return labelText;
      var text = String(button.innerText || button.textContent || "").replace(/\s+/g, " ").trim();
      if (text && !/switch branches/i.test(text)) return text;
      var aria = (button.getAttribute && button.getAttribute("aria-label")) || "";
      var current = aria.match(/current (?:branch|tag|ref)[:\s]+(.+)/i);
      if (current) return current[1].trim();
      var named = aria.match(/^(.+?)\s+(?:branch|tag)$/i);
      if (named) return named[1].trim();
      var title = String((button.getAttribute && button.getAttribute("title")) || "").trim();
      if (title && !/switch branches/i.test(title)) return title;
      if (aria && !/switch branches/i.test(aria)) return aria.trim();
    }
    return pathRef || "";
  }

  function splitMessage(message) {
    var normalized = String(message || "").replace(/\r\n/g, "\n");
    var idx = normalized.indexOf("\n");
    if (idx === -1) return { subject: normalized, body: "" };
    return { subject: normalized.slice(0, idx), body: normalized.slice(idx + 1).replace(/^\n/, "") };
  }

  function mapCommit(raw) {
    var commit = (raw && raw.commit) || {};
    var parts = splitMessage(commit.message || "");
    var author = commit.author || {};
    var login = raw && raw.author && raw.author.login;
    return {
      sha: raw.sha,
      subject: parts.subject,
      body: parts.body,
      authorName: author.name || login || "Unknown",
      authoredAt: author.date || "",
      parentShas: (raw.parents || []).map(function (parent) { return parent.sha; }),
      htmlUrl: raw.html_url || ""
    };
  }

  function isApiUrl(url) {
    return typeof url === "string" && url.indexOf("https://api.github.com/") === 0;
  }

  function nextLink(header) {
    if (!header) return null;
    var parts = String(header).split(",");
    for (var i = 0; i < parts.length; i++) {
      var match = parts[i].match(/<([^>]+)>;\s*rel="next"/);
      if (match && isApiUrl(match[1])) return match[1];
    }
    return null;
  }

  function classifyHttp(status, headers, text) {
    var message = "";
    try { message = (JSON.parse(text || "{}") || {}).message || ""; } catch (err) { message = String(text || ""); }
    headers = headers || {};
    var remaining = headers["x-ratelimit-remaining"];
    var reset = headers["x-ratelimit-reset"];
    if (status === 403 || status === 429) {
      if (remaining === "0" || status === 429 || /rate limit/i.test(message)) {
        return {
          kind: "rate_limit",
          resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : null
        };
      }
    }
    if (status === 401 || status === 403) return { kind: "unauthorized" };
    if (status === 404) return { kind: "not_found" };
    return { kind: "network" };
  }

  function stamp(commit) {
    var value = Date.parse(commit && commit.authoredAt || "");
    return Number.isNaN(value) ? 0 : value;
  }

  function byDate(a, b) {
    return stamp(b) - stamp(a);
  }

  function insertByDate(ready, commit) {
    var when = stamp(commit);
    var i = 0;
    while (i < ready.length && stamp(ready[i]) >= when) i += 1;
    ready.splice(i, 0, commit);
  }

  function orderCommits(commits) {
    var bySha = new Map();
    (commits || []).forEach(function (commit) {
      if (commit && commit.sha && !bySha.has(commit.sha)) bySha.set(commit.sha, commit);
    });
    var list = Array.from(bySha.values());
    var indeg = new Map();
    list.forEach(function (commit) { indeg.set(commit.sha, 0); });
    list.forEach(function (commit) {
      (commit.parentShas || []).forEach(function (parent) {
        if (bySha.has(parent)) indeg.set(parent, indeg.get(parent) + 1);
      });
    });
    var ready = list.filter(function (commit) { return indeg.get(commit.sha) === 0; });
    ready.sort(byDate);
    var out = [];
    while (ready.length) {
      var next = ready.shift();
      out.push(next);
      (next.parentShas || []).forEach(function (parent) {
        if (!bySha.has(parent)) return;
        indeg.set(parent, indeg.get(parent) - 1);
        if (indeg.get(parent) === 0) insertByDate(ready, bySha.get(parent));
      });
    }
    if (out.length < list.length) {
      var seen = new Set(out.map(function (commit) { return commit.sha; }));
      list.filter(function (commit) { return !seen.has(commit.sha); }).sort(byDate).forEach(function (commit) {
        out.push(commit);
      });
    }
    return out;
  }

  function reachableSet(tip, commits) {
    var bySha = new Map();
    (commits || []).forEach(function (commit) { bySha.set(commit.sha, commit); });
    var seen = {};
    var stack = [tip];
    while (stack.length) {
      var sha = stack.pop();
      if (!sha || seen[sha]) continue;
      seen[sha] = true;
      var commit = bySha.get(sha);
      if (commit) (commit.parentShas || []).forEach(function (parent) { stack.push(parent); });
    }
    return seen;
  }

  function filterScope(commits, scope, tip) {
    var list = commits || [];
    if (scope === "all" || !tip) return list.slice();
    if (!list.some(function (commit) { return commit.sha === tip; })) return list.slice();
    var seen = reachableSet(tip, list);
    return list.filter(function (commit) { return seen[commit.sha]; });
  }

  function matches(commit, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    return String(commit.subject || "").toLowerCase().indexOf(q) !== -1
      || String(commit.body || "").toLowerCase().indexOf(q) !== -1
      || String(commit.authorName || "").toLowerCase().indexOf(q) !== -1
      || String(commit.sha || "").toLowerCase().indexOf(q) !== -1;
  }

  function statusText(input) {
    if (input.loading) return "Loading commits…";
    if (input.error) return "Graph unavailable";
    var commits = input.commits || [];
    if (!commits.length) return "No commits";
    var query = String(input.query || "").trim();
    var matchCount = input.matchCount || 0;
    if (query && matchCount === 0) return "No matches in loaded commits";
    if (query) return matchCount + " of " + commits.length + " loaded commits match";
    var branch = input.branch || "this branch";
    if (input.totalCount) {
      var loaded = commits.length.toLocaleString("en-US");
      var total = Number(input.totalCount).toLocaleString("en-US");
      if (input.scope === "all") return "Showing " + loaded + " of " + total + " commits across branches";
      return "Showing " + loaded + " of " + total + " commits on " + branch;
    }
    if (input.scope === "all") return commits.length + " commits across branches";
    return commits.length + (commits.length === 1 ? " commit on " : " commits on ") + branch;
  }

  function relativeTime(iso, now) {
    var then = Date.parse(iso);
    if (Number.isNaN(then)) return "";
    var delta = Math.round((now - then) / 1000);
    if (delta < 0) delta = 0;
    var minutes = Math.max(1, Math.round(delta / 60));
    var hours = Math.round(delta / 3600);
    var days = Math.round(delta / 86400);
    if (hours < 1) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    if (days === 1) return "yesterday";
    if (days < 14) return days + " days ago";
    var weeks = Math.max(1, Math.round(days / 7));
    return weeks + (weeks === 1 ? " week ago" : " weeks ago");
  }

  function absoluteTime(iso) {
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var hh = String(d.getUTCHours()).padStart(2, "0");
    var mm = String(d.getUTCMinutes()).padStart(2, "0");
    return d.getUTCDate() + " " + months[d.getUTCMonth()] + " " + d.getUTCFullYear() + ", " + hh + ":" + mm + " UTC";
  }

  function safeCommitUrl(url) {
    if (typeof url === "string" && url.indexOf("https://github.com/") === 0) return url;
    return "https://github.com/";
  }

  return {
    parseRepoPath: parseRepoPath,
    readRef: readRef,
    splitMessage: splitMessage,
    mapCommit: mapCommit,
    isApiUrl: isApiUrl,
    nextLink: nextLink,
    classifyHttp: classifyHttp,
    orderCommits: orderCommits,
    reachableSet: reachableSet,
    filterScope: filterScope,
    matches: matches,
    statusText: statusText,
    relativeTime: relativeTime,
    absoluteTime: absoluteTime,
    safeCommitUrl: safeCommitUrl
  };
});
