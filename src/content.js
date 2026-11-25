/* Injects Files | Graph on a GitHub code tab. The graph lives in a shadow root so Primer does not restyle it. */
(function () {
  if (window.top !== window || window.__gwgBoot) return;
  window.__gwgBoot = true;

  var TOKEN_KEY = "gwg:token";
  var LIGHT = {
    "--bgColor-default": "#ffffff",
    "--bgColor-muted": "#f6f8fa",
    "--bgColor-accent-emphasis": "#0969da",
    "--bgColor-accent-muted": "#ddf4ff",
    "--bgColor-attention-muted": "#fff8c5",
    "--fgColor-default": "#1f2328",
    "--fgColor-muted": "#59636e",
    "--fgColor-accent": "#0969da",
    "--fgColor-onEmphasis": "#ffffff",
    "--borderColor-default": "#d1d9e0",
    "--focus-outlineColor": "#0969da",
    "--shadow-resting": "0 1px 3px rgba(31, 35, 40, 0.12)",
    "--shadow-floating": "0 8px 24px rgba(31, 35, 40, 0.12)"
  };
  var DARK = {
    "--bgColor-default": "#0d1117",
    "--bgColor-muted": "#151b23",
    "--bgColor-accent-emphasis": "#1f6feb",
    "--bgColor-accent-muted": "#1c2f4a",
    "--bgColor-attention-muted": "#3d2c0a",
    "--fgColor-default": "#e6edf3",
    "--fgColor-muted": "#9198a1",
    "--fgColor-accent": "#4493f8",
    "--fgColor-onEmphasis": "#ffffff",
    "--borderColor-default": "#3d444d",
    "--focus-outlineColor": "#4493f8",
    "--shadow-resting": "0 0 0 1px rgba(240, 246, 252, 0.1)",
    "--shadow-floating": "0 8px 24px rgba(1, 4, 9, 0.45)"
  };

  var state = freshState();
  var ui = null;
  var injectLock = false;
  var injectGen = 0;
  var loadGen = 0;
  var toastTimer = 0;
  var scheduled = 0;

  function freshState() {
    return {
      owner: "",
      repo: "",
      ref: "",
      view: "files",
      scope: "branch",
      query: "",
      selected: null,
      detailOpen: false,
      status: "idle",
      error: null,
      commits: [],
      refs: [],
      nextCursor: null,
      totalCount: null,
      branchTip: null,
      loadedRef: null,
      copied: "",
      listing: null,
      readmes: [],
      assignedFilesId: false
    };
  }

  function viewStorageKey(owner, repo) {
    return "gwg:view:" + owner + "/" + repo;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function isNarrow() {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  function isDark() {
    var mode = document.documentElement.getAttribute("data-color-mode");
    if (mode === "dark") return true;
    if (mode === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function syncTokens(host) {
    var dark = isDark();
    var fallback = dark ? DARK : LIGHT;
    var computed = getComputedStyle(document.documentElement);
    Object.keys(fallback).forEach(function (name) {
      var value = computed.getPropertyValue(name).trim();
      host.style.setProperty(name, value || fallback[name]);
    });
    host.style.setProperty("--gwg-scrim", dark ? "rgba(1, 4, 9, 0.6)" : "rgba(31, 35, 40, 0.4)");
    host.dataset.colorMode = dark ? "dark" : "light";
  }

  function findBranchButton() {
    return document.querySelector("#ref-picker-repos-header-ref-selector")
      || document.querySelector("#ref-picker-repos-header-ref-selector-wide")
      || document.querySelector("main button[data-hotkey='w']")
      || document.querySelector("main [data-hotkey='w']");
  }

  function findListing(branchButton) {
    var cell = document.querySelector("main .react-directory-filename-column")
      || document.querySelector(".react-directory-filename-column");
    if (!cell) return null;
    var marked = cell.closest("[data-testid='directory-content']");
    if (marked && (!branchButton || !marked.contains(branchButton))) return marked;
    var node = cell;
    while (node.parentElement && node.parentElement !== document.body) {
      if (branchButton && node.parentElement.contains(branchButton)) break;
      node = node.parentElement;
    }
    return node;
  }

  function findReadmes(listing) {
    var nodes = [];
    var seen = new Set();
    document.querySelectorAll("#readme, [data-testid='readme'], [id^='readme'], article.markdown-body").forEach(function (node) {
      var box = node.closest("article, .Box, [data-testid='readme']") || node;
      if (seen.has(box)) return;
      if (listing && (box === listing || box.contains(listing))) return;
      if (box.querySelector && box.querySelector(".gwg-toggle, #gwg-graph")) return;
      seen.add(box);
      nodes.push(box);
    });
    return nodes;
  }

  function setPanelHidden(node, hidden, immediate) {
    if (!node) return;
    node.__gwgGen = (node.__gwgGen || 0) + 1;
    var gen = String(node.__gwgGen);
    node.dataset.gwgGen = gen;
    var reduce = immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (hidden) {
      node.inert = true;
      node.setAttribute("aria-hidden", "true");
      if (reduce) {
        node.classList.add("gwg-host-hidden");
        node.classList.remove("gwg-panel-leave");
        return;
      }
      node.classList.add("gwg-panel-leave");
      var finish = function () {
        if (node.dataset.gwgGen !== gen) return;
        node.classList.add("gwg-host-hidden");
      };
      node.addEventListener("transitionend", function onEnd(event) {
        if (event.target !== node) return;
        node.removeEventListener("transitionend", onEnd);
        finish();
      });
      setTimeout(finish, 220);
      return;
    }
    node.classList.remove("gwg-host-hidden");
    node.inert = false;
    node.removeAttribute("aria-hidden");
    if (reduce) {
      node.classList.remove("gwg-panel-leave");
      return;
    }
    node.classList.add("gwg-panel-leave");
    void node.offsetWidth;
    window.requestAnimationFrame(function () {
      if (node.dataset.gwgGen !== gen) return;
      node.classList.remove("gwg-panel-leave");
    });
  }

  function removeUi() {
    if (state.assignedFilesId && state.listing && state.listing.id === "gwg-files") state.listing.removeAttribute("id");
    document.querySelectorAll(".gwg-toggle, .gwg-altbar, #gwg-graph").forEach(function (node) { node.remove(); });
    document.querySelectorAll(".gwg-host-hidden, .gwg-panel-leave, .gwg-files-anim, .gwg-toolbar-host").forEach(function (node) {
      node.classList.remove("gwg-host-hidden", "gwg-panel-leave", "gwg-files-anim", "gwg-toolbar-host");
      node.inert = false;
      node.removeAttribute("aria-hidden");
    });
    ui = null;
    state.listing = null;
    state.readmes = [];
    state.assignedFilesId = false;
    state.commits = [];
    state.refs = [];
    state.nextCursor = null;
    state.branchTip = null;
    state.loadedRef = null;
    state.status = "idle";
    state.selected = null;
    state.detailOpen = false;
    state.error = null;
  }

  function scopedCommits() {
    return GWGModel.filterScope(state.commits, state.scope, state.branchTip);
  }

  function errorView(error) {
    var kind = error && error.kind;
    if (kind === "rate_limit") {
      var when = error.resetAt ? GWGModel.absoluteTime(error.resetAt) : "";
      var body = "Unauthenticated requests are limited to 60 per hour. ";
      if (when) body += "The limit resets at " + when + ". ";
      body += "A personal access token raises the limit.";
      return { title: "GitHub rate limit reached", body: body, options: true };
    }
    if (kind === "unauthorized" || kind === "not_found") {
      return {
        title: "Cannot read this repository",
        body: "GitHub refused the request. For a private repository, add a token that can read this repo. The extension only needs contents: read.",
        options: true
      };
    }
    return {
      title: "Could not load the graph",
      body: "The request to GitHub failed. Check the connection and retry.",
      options: false
    };
  }

  function showToast(text) {
    if (!ui) return;
    ui.toast.textContent = text;
    ui.toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      if (ui) ui.toast.classList.remove("show");
    }, 2400);
  }

  function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    area.remove();
    return ok;
  }

  function copyText(sha, which) {
    writeClipboard(sha).then(function (ok) {
      if (!ok) {
        showToast("Could not copy the commit SHA.");
        return;
      }
      state.copied = which;
      paint();
      window.setTimeout(function () {
        if (state.copied === which) {
          state.copied = "";
          paint();
        }
      }, 1600);
    });
  }

  function choose(sha, opts) {
    state.selected = sha;
    state.detailOpen = true;
    paint();
    if (!ui) return;
    var row = ui.tbody.querySelector('[data-sha="' + sha + '"]');
    if (row && opts && opts.scroll) row.scrollIntoView({ block: "nearest" });
    if (row && opts && opts.focus) row.focus();
  }

  function closeDetail() {
    state.detailOpen = false;
    paint();
    if (!ui || !state.selected) return;
    var row = ui.tbody.querySelector('[data-sha="' + state.selected + '"]');
    if (row) row.focus();
  }

  function move(delta) {
    var commits = scopedCommits();
    if (!commits.length) return;
    var index = commits.findIndex(function (commit) { return commit.sha === state.selected; });
    if (index === -1) index = delta > 0 ? -1 : 0;
    var next = Math.max(0, Math.min(commits.length - 1, index + delta));
    choose(commits[next].sha, { focus: true, scroll: true });
  }

  function openParent(sha) {
    if (scopedCommits().some(function (commit) { return commit.sha === sha; })) {
      choose(sha, { focus: false, scroll: true });
      return;
    }
    showToast("That parent is not in the loaded history. Load older commits and try again.");
  }

  function renderRows() {
    var scoped = scopedCommits();
    var laid = GWGLayout.layoutGraph(scoped);
    var rowBySha = {};
    laid.rows.forEach(function (row) { rowBySha[row.sha] = row; });
    var extra = laid.rows.some(function (row) { return row.extraParents > 0; });
    ui.table.style.minWidth = (GWGGlyph.laneWidth(laid.maxCols, extra) + 160 + 112 + 140 + 88) + "px";
    var focusSha = ui.shadow.activeElement && ui.shadow.activeElement.dataset
      ? ui.shadow.activeElement.dataset.sha
      : "";
    var tabSha = scoped.some(function (commit) { return commit.sha === state.selected; })
      ? state.selected
      : (scoped[0] ? scoped[0].sha : "");
    var query = state.query.trim();
    ui.tbody.replaceChildren();
    scoped.forEach(function (commit) {
      var info = rowBySha[commit.sha];
      var match = GWGModel.matches(commit, state.query);
      var tr = document.createElement("tr");
      tr.dataset.sha = commit.sha;
      tr.tabIndex = commit.sha === tabSha ? 0 : -1;
      tr.setAttribute("aria-selected", commit.sha === state.selected ? "true" : "false");
      if (query && !match) tr.classList.add("is-dim");

      var graphCell = document.createElement("td");
      graphCell.className = "col-graph";
      graphCell.innerHTML = GWGGlyph.glyphMarkup(info, laid.maxCols, commit.sha === state.branchTip);

      var desc = document.createElement("td");
      var line = el("div", "subject-line");
      var subject = el("span", "subject", commit.subject || "(empty)");
      subject.title = commit.subject || "";
      var pills = el("span", "pills");
      refsFor(commit.sha).forEach(function (ref) {
        var pill = el("span", "pill");
        pill.title = "Branch " + ref.name;
        if (ref.name === state.ref) {
          pill.classList.add("current");
          pill.append(el("span", "pill-text", ref.name), el("span", "vh", ", current branch"));
        } else {
          var dot = el("span", "dot");
          dot.style.background = GWGGlyph.laneColor(info.col);
          pill.append(dot, el("span", "pill-text", ref.name));
        }
        pills.append(pill);
      });
      line.append(subject, pills);
      var meta = el("div", "meta-line", commit.authorName + " · " + GWGModel.relativeTime(commit.authoredAt, Date.now()));
      desc.append(line, meta);

      var date = document.createElement("td");
      date.className = "col-date";
      date.textContent = GWGModel.relativeTime(commit.authoredAt, Date.now());
      date.title = GWGModel.absoluteTime(commit.authoredAt);

      var author = document.createElement("td");
      author.className = "col-author";
      author.textContent = commit.authorName;
      author.title = commit.authorName;

      var shaCell = document.createElement("td");
      shaCell.className = "col-sha";
      var short = commit.sha.slice(0, 7);
      var copied = state.copied === "row:" + commit.sha;
      var hash = el("button", "hash", copied ? "Copied" : short);
      hash.type = "button";
      hash.tabIndex = -1;
      hash.setAttribute("aria-label", (copied ? "Copied " : "Copy ") + short);
      hash.addEventListener("mousedown", function (event) { event.preventDefault(); });
      hash.addEventListener("click", function (event) {
        event.stopPropagation();
        choose(commit.sha, { focus: true });
        copyText(commit.sha, "row:" + commit.sha);
      });
      shaCell.append(hash);
      tr.append(graphCell, desc, date, author, shaCell);
      tr.addEventListener("click", function () { choose(commit.sha, { focus: true }); });
      ui.tbody.append(tr);
    });
    if (focusSha) {
      var again = ui.tbody.querySelector('[data-sha="' + focusSha + '"]');
      if (again) again.focus();
    }
  }

  function refsFor(sha) {
    return state.refs.filter(function (ref) {
      return ref.sha === sha && ref.kind !== "tag";
    }).sort(function (a, b) {
      var ac = a.name === state.ref ? 0 : 1;
      var bc = b.name === state.ref ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  }

  function renderDetail(showTable) {
    var commit = null;
    state.commits.forEach(function (item) {
      if (item.sha === state.selected) commit = item;
    });
    var open = !!(showTable && state.detailOpen && commit);
    var narrow = isNarrow();
    ui.detail.classList.toggle("is-open", open);
    ui.detail.inert = !open;
    ui.detail.setAttribute("aria-hidden", open ? "false" : "true");
    if (narrow && open) {
      ui.detail.setAttribute("role", "dialog");
      ui.detail.setAttribute("aria-modal", "true");
    } else {
      ui.detail.setAttribute("role", "region");
      ui.detail.removeAttribute("aria-modal");
    }
    ui.scrim.classList.toggle("is-open", open && narrow);
    if (!commit) return;
    ui.title.textContent = commit.subject || "(empty)";
    ui.detail.setAttribute("aria-labelledby", "gwg-detail-title");
    if (commit.body) {
      ui.detailBody.textContent = commit.body;
      ui.detailBody.classList.remove("quiet");
    } else {
      ui.detailBody.textContent = "No description.";
      ui.detailBody.classList.add("quiet");
    }
    ui.authorDd.textContent = commit.authorName;
    ui.authoredDd.textContent = GWGModel.absoluteTime(commit.authoredAt);
    ui.shaDd.textContent = commit.sha;
    ui.parentsDd.replaceChildren();
    if (!commit.parentShas.length) {
      ui.parentsDd.append(el("span", "quiet", "None. This is the root commit."));
    } else {
      var list = el("div", "parent-list");
      commit.parentShas.forEach(function (sha) {
        var button = el("button", "", sha.slice(0, 7));
        button.type = "button";
        button.addEventListener("click", function () { openParent(sha); });
        list.append(button);
      });
      ui.parentsDd.append(list);
    }
    var names = refsFor(commit.sha).map(function (ref) { return ref.name; });
    ui.refsDt.hidden = names.length === 0;
    ui.refsDd.hidden = names.length === 0;
    ui.refsDd.textContent = names.join(", ");
    ui.mergeNote.hidden = commit.parentShas.length < 2;
    ui.mergeNote.textContent = "This commit joins more than one parent. The graph draws it as a diamond.";
    var copied = state.copied === "detail";
    ui.copyBtn.textContent = copied ? "Copied" : "Copy SHA";
    ui.viewLink.href = GWGModel.safeCommitUrl(commit.htmlUrl);
  }

  function paint() {
    if (!ui) return;
    syncTokens(ui.host);
    var loading = state.status === "loading";
    var scoped = scopedCommits();
    var matchCount = scoped.filter(function (commit) { return GWGModel.matches(commit, state.query); }).length;
    ui.status.textContent = GWGModel.statusText({
      loading: loading,
      error: state.status === "error",
      commits: scoped,
      query: state.query,
      matchCount: matchCount,
      scope: state.scope,
      branch: state.ref || "this branch",
      totalCount: state.totalCount
    });
    var skeleton = loading && state.commits.length === 0;
    var block = state.status === "error" || state.status === "empty" || (state.status === "ready" && scoped.length === 0);
    var showTable = !skeleton && !block && scoped.length > 0;
    ui.search.disabled = loading;
    ui.scopeSelect.disabled = loading;
    ui.clearBtn.hidden = !state.query;
    ui.search.classList.toggle("has-clear", !!state.query);
    if (ui.shadow.activeElement !== ui.search && ui.search.value !== state.query) ui.search.value = state.query;
    if (ui.scopeSelect.value !== state.scope) ui.scopeSelect.value = state.scope;
    ui.host.setAttribute("aria-busy", skeleton ? "true" : "false");
    ui.skel.hidden = !skeleton;
    ui.stateBlock.hidden = !block;
    ui.body.hidden = !showTable;
    ui.banner.hidden = !(state.query.trim() && matchCount === 0 && showTable);
    if (!ui.banner.hidden) {
      ui.bannerText.textContent = "No commits match “" + state.query.trim() + "”. Loaded rows stay visible, in muted text, so the lanes do not break.";
    }
    if (state.status === "error") {
      var view = errorView(state.error);
      ui.stateTitle.textContent = view.title;
      ui.stateBody.textContent = view.body;
      ui.optionsBtn.hidden = !view.options;
    } else if (block) {
      ui.stateTitle.textContent = "No commits to graph";
      ui.stateBody.textContent = "This repository does not have a commit on the selected branch yet.";
      ui.optionsBtn.hidden = true;
    }
    ui.more.hidden = !(state.nextCursor && showTable && !loading);
    if (showTable) renderRows();
    renderDetail(showTable);
  }

  function apiFetch(url, token) {
    var headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (token) headers.Authorization = "Bearer " + token;
    return chrome.runtime.sendMessage({ type: "gwg:fetch", url: url, headers: headers });
  }

  function load(mode) {
    if (mode === "more" && !state.nextCursor) return;
    var gen = ++loadGen;
    var cursor = mode === "more" ? state.nextCursor : null;
    var previous = cursor ? { commits: state.commits, refs: state.refs, branchTip: state.branchTip } : null;
    state.status = "loading";
    paint();
    chrome.storage.local.get(TOKEN_KEY, function (data) {
      if (gen !== loadGen) return;
      var token = (data && data[TOKEN_KEY]) || "";
      GWGGithub.loadGraph({
        fetchImpl: apiFetch,
        owner: state.owner,
        repo: state.repo,
        ref: state.ref || "HEAD",
        token: token,
        cursor: cursor,
        previous: previous
      }).then(function (page) {
        if (gen !== loadGen) return;
        state.commits = page.commits;
        state.refs = page.refs;
        state.nextCursor = page.nextCursor;
        state.totalCount = page.totalCount;
        state.branchTip = page.branchTip;
        state.error = null;
        state.status = page.commits.length ? "ready" : "empty";
        state.loadedRef = state.ref;
        if (state.selected && !scopedCommits().some(function (commit) { return commit.sha === state.selected; })) {
          state.selected = null;
          state.detailOpen = false;
        }
        paint();
      }).catch(function (err) {
        if (gen !== loadGen) return;
        state.error = err && err.kind ? err : { kind: "network" };
        state.status = "error";
        state.loadedRef = state.ref;
        paint();
      });
    });
  }

  function persistView() {
    var box = {};
    box[viewStorageKey(state.owner, state.repo)] = state.view;
    chrome.storage.local.set(box);
  }

  function applyView(view, immediate) {
    state.view = view === "graph" ? "graph" : "files";
    var graphOn = state.view === "graph";
    ui.filesBtn.setAttribute("aria-pressed", graphOn ? "false" : "true");
    ui.graphBtn.setAttribute("aria-pressed", graphOn ? "true" : "false");
    setPanelHidden(state.listing, graphOn, immediate);
    state.readmes.forEach(function (node) { setPanelHidden(node, graphOn, immediate); });
    setPanelHidden(ui.host, !graphOn, immediate);
    persistView();
    if (graphOn && state.loadedRef !== state.ref) load("replace");
    else paint();
  }

  function trapTab(event) {
    var nodes = Array.prototype.filter.call(ui.detail.querySelectorAll("button, a, input, select, textarea"), function (node) {
      return !node.disabled && node.tabIndex !== -1 && node.offsetParent !== null;
    });
    if (!nodes.length) return;
    var active = ui.shadow.activeElement;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (event.shiftKey && (active === first || !ui.detail.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onShadowKey(event) {
    if (event.key === "Escape") {
      if (event.target === ui.search) {
        if (state.query) {
          event.preventDefault();
          state.query = "";
          ui.search.value = "";
          paint();
          ui.search.focus();
        }
        return;
      }
      if (state.detailOpen) {
        event.preventDefault();
        closeDetail();
      }
      return;
    }
    if (event.key === "Tab" && isNarrow() && state.detailOpen && ui.detail.classList.contains("is-open")) {
      trapTab(event);
      return;
    }
    if (ui.detail.contains(event.target)) return;
    if (event.target.closest && event.target.closest("a, button, input, select")) return;
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Home") { event.preventDefault(); move(-100000); }
    else if (event.key === "End") { event.preventDefault(); move(100000); }
    else if (event.key === "PageDown") { event.preventDefault(); move(10); }
    else if (event.key === "PageUp") { event.preventDefault(); move(-10); }
    else if (event.key === "Enter" && state.selected) {
      event.preventDefault();
      state.detailOpen = true;
      paint();
      ui.title.focus();
    }
  }

  function buildPanel(host) {
    var shadow = host.attachShadow({ mode: "open", delegatesFocus: true });
    var root = el("div", "gwg-root");
    var toolbar = el("div", "gwg-toolbar");
    var searchLabel = el("label", "vh", "Filter commits");
    searchLabel.htmlFor = "gwg-search";
    var searchWrap = el("div", "search-wrap");
    var search = el("input", "gwg-search");
    search.id = "gwg-search";
    search.type = "text";
    search.placeholder = "Filter by message, author, or SHA";
    search.autocomplete = "off";
    search.spellcheck = false;
    var clearBtn = el("button", "clear-search", "Clear");
    clearBtn.type = "button";
    clearBtn.hidden = true;
    searchWrap.append(search, clearBtn);
    var scopeLabel = el("label", "vh", "History scope");
    scopeLabel.htmlFor = "gwg-scope";
    var scopeSelect = el("select", "gwg-select");
    scopeSelect.id = "gwg-scope";
    var optBranch = el("option", "", "This branch");
    optBranch.value = "branch";
    var optAll = el("option", "", "All branches");
    optAll.value = "all";
    scopeSelect.append(optBranch, optAll);
    var refresh = el("button", "gwg-btn", "Refresh");
    refresh.type = "button";
    var status = el("div", "gwg-status");
    toolbar.append(searchLabel, searchWrap, scopeLabel, scopeSelect, refresh, status);

    var banner = el("div", "match-banner");
    banner.hidden = true;
    var bannerText = el("p");
    var bannerClear = el("button", "gwg-btn", "Clear search");
    bannerClear.type = "button";
    banner.append(bannerText, bannerClear);

    var stateBlock = el("div", "state");
    stateBlock.hidden = true;
    var stateTitle = el("h2");
    var stateBody = el("p");
    var actions = el("div", "state-actions");
    var retry = el("button", "gwg-btn", "Retry");
    retry.type = "button";
    var optionsBtn = el("button", "gwg-btn", "Extension options");
    optionsBtn.type = "button";
    actions.append(retry, optionsBtn);
    stateBlock.append(stateTitle, stateBody, actions);

    var skel = el("div", "skel");
    skel.hidden = true;
    for (var s = 0; s < 8; s++) {
      var bone = el("div", "skel-row");
      bone.append(el("div", "skel-dot"), el("div", "skel-bar"));
      skel.append(bone);
    }

    var body = el("div", "gwg-body");
    var main = el("div", "gwg-main");
    var scroll = el("div", "gwg-scroll");
    var table = el("table", "gwg-table");
    var caption = el("caption", "vh", "Commits, newest first. Up and down arrows move the selection. Escape closes the detail.");
    var headRow = document.createElement("tr");
    ["Graph", "Description", "Date", "Author", "Commit"].forEach(function (name, index) {
      var cell = document.createElement("th");
      cell.className = ["col-graph", "", "col-date", "col-author", "col-sha"][index];
      if (name === "Graph") cell.append(el("span", "vh", "Graph"));
      else cell.textContent = name;
      headRow.append(cell);
    });
    var thead = document.createElement("thead");
    thead.append(headRow);
    var tbody = document.createElement("tbody");
    table.append(caption, thead, tbody);
    scroll.append(table);
    var more = el("button", "load-more", "Load older commits");
    more.type = "button";
    more.hidden = true;
    main.append(scroll, more);

    var detail = el("aside", "detail");
    detail.setAttribute("role", "region");
    detail.setAttribute("aria-hidden", "true");
    var inner = el("div", "detail-inner");
    var closeBtn = el("button", "gwg-btn sheet-close", "Close");
    closeBtn.type = "button";
    var title = el("h2");
    title.id = "gwg-detail-title";
    title.tabIndex = -1;
    var detailBody = el("p", "body");
    var dl = document.createElement("dl");
    function pair(term) {
      var dt = document.createElement("dt");
      dt.textContent = term;
      var dd = document.createElement("dd");
      dl.append(dt, dd);
      return { dt: dt, dd: dd };
    }
    var author = pair("Author");
    var authored = pair("Authored");
    var sha = pair("Commit");
    sha.dd.className = "sha-full";
    var parents = pair("Parents");
    var refs = pair("Refs");
    var mergeNote = el("p", "quiet merge");
    mergeNote.hidden = true;
    var detailActions = el("div", "detail-actions");
    var copyBtn = el("button", "gwg-btn", "Copy SHA");
    copyBtn.type = "button";
    var viewLink = el("a", "view-link", "View on GitHub");
    detailActions.append(copyBtn, viewLink);
    var hint = el("p", "keys", "Up and down move. Esc closes.");
    inner.append(closeBtn, title, detailBody, dl, mergeNote, detailActions, hint);
    detail.append(inner);
    body.append(main, detail);

    var scrim = el("button", "scrim");
    scrim.type = "button";
    scrim.setAttribute("aria-label", "Close commit detail");
    scrim.tabIndex = -1;
    var toast = el("div", "toast");
    toast.setAttribute("role", "status");
    root.append(toolbar, banner, stateBlock, skel, body, scrim, toast);
    shadow.append(root);

    fetch(chrome.runtime.getURL("src/graph.css")).then(function (res) { return res.text(); }).then(function (css) {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
    }).catch(function () {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("src/graph.css");
      shadow.append(link);
    });

    shadow.addEventListener("keydown", onShadowKey);
    search.addEventListener("input", function () {
      state.query = search.value;
      paint();
    });
    search.addEventListener("keydown", function (event) {
      if (event.key === "Tab" && event.shiftKey && state.view === "graph") {
        event.preventDefault();
        ui.graphBtn.focus();
      }
    });
    clearBtn.addEventListener("click", function () {
      state.query = "";
      search.value = "";
      paint();
      search.focus();
    });
    bannerClear.addEventListener("click", function () {
      state.query = "";
      search.value = "";
      paint();
      search.focus();
    });
    scopeSelect.addEventListener("change", function () {
      state.scope = scopeSelect.value === "all" ? "all" : "branch";
      if (state.selected && !scopedCommits().some(function (commit) { return commit.sha === state.selected; })) {
        state.selected = null;
        state.detailOpen = false;
      }
      paint();
    });
    refresh.addEventListener("click", function () { load("replace"); });
    retry.addEventListener("click", function () { load("replace"); });
    optionsBtn.addEventListener("click", function () { chrome.runtime.openOptionsPage(); });
    more.addEventListener("click", function () { load("more"); });
    closeBtn.addEventListener("click", closeDetail);
    scrim.addEventListener("click", closeDetail);
    copyBtn.addEventListener("click", function () {
      if (state.selected) copyText(state.selected, "detail");
    });

    return {
      shadow: shadow,
      host: host,
      search: search,
      clearBtn: clearBtn,
      scopeSelect: scopeSelect,
      status: status,
      banner: banner,
      bannerText: bannerText,
      stateBlock: stateBlock,
      stateTitle: stateTitle,
      stateBody: stateBody,
      optionsBtn: optionsBtn,
      skel: skel,
      body: body,
      table: table,
      tbody: tbody,
      more: more,
      detail: detail,
      title: title,
      detailBody: detailBody,
      authorDd: author.dd,
      authoredDd: authored.dd,
      shaDd: sha.dd,
      parentsDd: parents.dd,
      refsDt: refs.dt,
      refsDd: refs.dd,
      mergeNote: mergeNote,
      copyBtn: copyBtn,
      viewLink: viewLink,
      scrim: scrim,
      toast: toast
    };
  }

  function mount(parsed, branchButton, listing, view) {
    var parent = listing && listing.parentElement;
    if (!parent && branchButton && branchButton.parentElement) parent = branchButton.parentElement.parentElement;
    if (!parent) return;

    state.owner = parsed.owner;
    state.repo = parsed.repo;
    state.ref = GWGModel.readRef(branchButton, parsed.refFromPath);
    state.view = view;
    state.scope = "branch";
    state.query = "";
    state.listing = listing;
    state.readmes = findReadmes(listing);

    var toggle = el("div", "gwg-toggle");
    toggle.setAttribute("role", "group");
    toggle.setAttribute("aria-label", "Code view");
    var filesBtn = el("button", "", "Files");
    filesBtn.type = "button";
    var graphBtn = el("button", "", "Graph");
    graphBtn.type = "button";
    toggle.append(filesBtn, graphBtn);
    if (branchButton) {
      branchButton.insertAdjacentElement("afterend", toggle);
      if (toggle.parentElement) toggle.parentElement.classList.add("gwg-toolbar-host");
    } else {
      var bar = el("div", "gwg-altbar");
      bar.append(toggle);
      listing.parentElement.insertBefore(bar, listing);
    }

    var host = el("div");
    host.id = "gwg-graph";
    host.className = "gwg-host gwg-host-hidden";
    if (listing) listing.parentElement.insertBefore(host, listing);
    else branchButton.parentElement.parentElement.insertBefore(host, branchButton.parentElement.nextSibling);

    if (listing) {
      listing.classList.add("gwg-files-anim");
      if (!listing.id) {
        listing.id = "gwg-files";
        state.assignedFilesId = true;
      }
      filesBtn.setAttribute("aria-controls", listing.id);
    } else {
      filesBtn.setAttribute("aria-controls", "gwg-files");
    }
    graphBtn.setAttribute("aria-controls", "gwg-graph");
    graphBtn.addEventListener("keydown", function (event) {
      if (event.key === "Tab" && !event.shiftKey && state.view === "graph") {
        event.preventDefault();
        ui.search.focus();
      }
    });
    filesBtn.addEventListener("click", function () { applyView("files", false); });
    graphBtn.addEventListener("click", function () { applyView("graph", false); });

    ui = buildPanel(host);
    ui.toggle = toggle;
    ui.filesBtn = filesBtn;
    ui.graphBtn = graphBtn;
    ui.host = host;
    applyView(view, true);
  }

  function noteRef(branchButton, parsed) {
    if (!branchButton) return;
    var ref = GWGModel.readRef(branchButton, parsed.refFromPath);
    if (!ref || ref === state.ref) return;
    state.ref = ref;
    state.selected = null;
    state.detailOpen = false;
    if (state.view === "graph") load("replace");
  }

  function syncReadmes() {
    var readmes = findReadmes(state.listing);
    state.readmes = readmes;
    if (state.view !== "graph") return;
    readmes.forEach(function (node) {
      if (!node.classList.contains("gwg-host-hidden")) setPanelHidden(node, true, true);
    });
  }

  function ensure() {
    var parsed = GWGModel.parseRepoPath(location.pathname);
    if (!parsed || !parsed.code) {
      if (ui) removeUi();
      return;
    }
    if (ui && ui.toggle.isConnected && ui.host.isConnected && state.owner === parsed.owner && state.repo === parsed.repo) {
      noteRef(findBranchButton(), parsed);
      syncReadmes();
      return;
    }
    if (injectLock) return;
    injectLock = true;
    var gen = ++injectGen;
    var key = viewStorageKey(parsed.owner, parsed.repo);
    chrome.storage.local.get(key, function (data) {
      injectLock = false;
      if (gen !== injectGen) return;
      var again = GWGModel.parseRepoPath(location.pathname);
      if (!again || !again.code || again.owner !== parsed.owner || again.repo !== parsed.repo) return;
      var branchButton = findBranchButton();
      var listing = findListing(branchButton);
      if (!branchButton && !listing) return;
      removeUi();
      mount(again, branchButton, listing, data && data[key] === "graph" ? "graph" : "files");
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = window.requestAnimationFrame(function () {
      scheduled = 0;
      ensure();
    });
  }

  document.addEventListener("turbo:render", schedule);
  document.addEventListener("turbo:load", schedule);
  window.addEventListener("popstate", schedule);
  window.addEventListener("resize", function () { if (ui) renderDetail(!ui.body.hidden); });
  new MutationObserver(syncTokensOnPage).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-color-mode", "data-dark-theme", "data-light-theme", "class"]
  });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();

  function syncTokensOnPage() {
    if (ui) syncTokens(ui.host);
  }
})();
