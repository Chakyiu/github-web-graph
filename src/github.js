/* GitHub REST client. GraphQL is authenticated-only, so public repos use REST. */
(function (root, factory) {
  var model = typeof module === "object" && module.exports ? require("./model") : root.GWGModel;
  var api = factory(model);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GWGGithub = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (model) {
  var PRIMARY_PAGE = 30;
  var EXTRA_BRANCHES = 4;
  var EXTRA_PAGE = 10;

  function repoBase(owner, repo) {
    return "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  }

  async function readJson(fetchImpl, url, token) {
    if (!model.isApiUrl(url)) throw { kind: "network" };
    var res;
    try {
      res = await fetchImpl(url, token);
    } catch (err) {
      throw { kind: "network" };
    }
    if (!res || !res.status) throw { kind: "network" };
    var headers = res.headers || {};
    if (res.status === 409) return { empty: true, data: [], headers: headers };
    if (!res.ok) throw model.classifyHttp(res.status, headers, res.text || "");
    try {
      return { empty: false, data: JSON.parse(res.text || "null"), headers: headers };
    } catch (err) {
      throw { kind: "network" };
    }
  }

  async function readCommits(fetchImpl, url, token) {
    var body = await readJson(fetchImpl, url, token);
    if (body.empty) return { commits: [], nextCursor: null };
    if (!Array.isArray(body.data)) throw { kind: "network" };
    return {
      commits: body.data.map(model.mapCommit),
      nextCursor: model.nextLink(body.headers.link)
    };
  }

  async function readBranches(fetchImpl, url, token) {
    var body = await readJson(fetchImpl, url, token);
    if (body.empty || !Array.isArray(body.data)) return [];
    return body.data.filter(function (branch) {
      return branch && branch.name && branch.commit && branch.commit.sha;
    }).map(function (branch) {
      return { name: branch.name, sha: branch.commit.sha };
    });
  }

  async function loadGraph(options) {
    var fetchImpl = options.fetchImpl;
    var token = options.token || "";
    var previous = options.previous || null;
    if (options.cursor) {
      var page = await readCommits(fetchImpl, options.cursor, token);
      return {
        commits: model.orderCommits((previous && previous.commits ? previous.commits : []).concat(page.commits)),
        refs: (previous && previous.refs) || [],
        nextCursor: page.nextCursor,
        totalCount: null,
        branchTip: (previous && previous.branchTip) || null
      };
    }

    var base = repoBase(options.owner, options.repo);
    var commitPage = await readCommits(
      fetchImpl,
      base + "/commits?sha=" + encodeURIComponent(options.ref) + "&per_page=" + PRIMARY_PAGE,
      token
    );
    var refs = [];
    try {
      refs = await readBranches(fetchImpl, base + "/branches?per_page=100", token);
    } catch (err) {
      if (err && (err.kind === "rate_limit" || err.kind === "unauthorized" || err.kind === "not_found")) throw err;
      refs = [];
    }

    var commits = commitPage.commits.slice();
    var have = {};
    commits.forEach(function (commit) { have[commit.sha] = true; });
    // shortcut: other branches are sampled (up to 4 tips, 10 commits each) on refresh; load-older only pages the selected ref. Upgrade when a full all-refs walk is worth the rate limit.
    var extras = [];
    for (var i = 0; i < refs.length && extras.length < EXTRA_BRANCHES; i++) {
      if (refs[i].name === options.ref || have[refs[i].sha]) continue;
      extras.push(refs[i]);
    }
    for (var e = 0; e < extras.length; e++) {
      try {
        var extra = await readCommits(
          fetchImpl,
          base + "/commits?sha=" + encodeURIComponent(extras[e].name) + "&per_page=" + EXTRA_PAGE,
          token
        );
        commits = commits.concat(extra.commits);
      } catch (err) {
        if (err && err.kind === "rate_limit") throw err;
      }
    }

    return {
      commits: model.orderCommits(commits),
      refs: refs.map(function (ref) { return { name: ref.name, kind: "branch", sha: ref.sha }; }),
      nextCursor: commitPage.nextCursor,
      totalCount: null,
      branchTip: commitPage.commits[0] ? commitPage.commits[0].sha : null
    };
  }

  return {
    loadGraph: loadGraph,
    PRIMARY_PAGE: PRIMARY_PAGE,
    EXTRA_BRANCHES: EXTRA_BRANCHES
  };
});
