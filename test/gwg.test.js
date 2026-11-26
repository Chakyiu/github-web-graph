const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../src/model");
const layout = require("../src/layout");
const glyph = require("../src/glyph");
const github = require("../src/github");

function button(opts) {
  return {
    querySelector: function () {
      return opts.label ? { textContent: opts.label } : null;
    },
    getAttribute: function (name) {
      return (opts.attr || {})[name] || "";
    },
    textContent: opts.text || "",
    innerText: opts.text || ""
  };
}

function rawCommit(sha, date, parents, message) {
  return {
    sha: sha,
    html_url: "https://github.com/octocat/Hello-World/commit/" + sha,
    commit: { message: message, author: { name: "The Octocat", date: date } },
    author: { login: "octocat" },
    parents: parents.map(function (parent) { return { sha: parent }; })
  };
}

test("parseRepoPath accepts the code tab only", function () {
  assert.deepEqual(model.parseRepoPath("/octocat/Hello-World"), {
    owner: "octocat",
    repo: "Hello-World",
    refFromPath: null,
    code: true
  });
  assert.equal(model.parseRepoPath("/octocat/Hello-World/tree/feature/foo/src").refFromPath, "feature/foo/src");
  assert.equal(model.parseRepoPath("/octocat/Hello-World/blob/master/README.md").code, false);
  assert.equal(model.parseRepoPath("/settings/profile"), null);
  assert.equal(model.parseRepoPath("/octocat"), null);
});

test("readRef prefers the visible branch name", function () {
  assert.equal(model.readRef(button({ label: "master", attr: { "aria-label": "master branch" } }), "other"), "master");
  assert.equal(model.readRef(button({ attr: { "aria-label": "develop branch" } }), ""), "develop");
  assert.equal(model.readRef(null, "main/src"), "main/src");
});

test("mapCommit splits the subject and keeps parents", function () {
  var commit = model.mapCommit(rawCommit(
    "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
    "2012-03-06T23:06:50Z",
    ["553c2077f0edc3d5dc5d17262f6aa498e69d6f8e", "762941318ee16e59dabbacb1b4049eec22f0d303"],
    "Merge pull request #6 from Spaceghost/patch-1\n\nNew line at end of file."
  ));
  assert.equal(commit.subject, "Merge pull request #6 from Spaceghost/patch-1");
  assert.equal(commit.body, "New line at end of file.");
  assert.equal(commit.authorName, "The Octocat");
  assert.deepEqual(commit.parentShas, [
    "553c2077f0edc3d5dc5d17262f6aa498e69d6f8e",
    "762941318ee16e59dabbacb1b4049eec22f0d303"
  ]);
});

test("classifyHttp and nextLink", function () {
  assert.equal(model.classifyHttp(404, {}, "{\"message\":\"Not Found\"}").kind, "not_found");
  assert.equal(model.classifyHttp(401, {}, "{}").kind, "unauthorized");
  var limited = model.classifyHttp(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000" }, "{\"message\":\"rate limit\"}");
  assert.equal(limited.kind, "rate_limit");
  assert.equal(limited.resetAt, new Date(1700000000 * 1000).toISOString());
  assert.equal(
    model.nextLink('<https://evil.example/next>; rel="next", <https://api.github.com/repos/o/r/commits?page=2>; rel="next"'),
    "https://api.github.com/repos/o/r/commits?page=2"
  );
  assert.equal(model.nextLink('<https://evil.example/next>; rel="next"'), null);
});

test("order keeps a parent below its child", function () {
  var ordered = model.orderCommits([
    { sha: "c", authoredAt: "2020-01-01T00:00:00Z", parentShas: [] },
    { sha: "a", authoredAt: "2020-01-03T00:00:00Z", parentShas: ["b"] },
    { sha: "b", authoredAt: "2020-01-04T00:00:00Z", parentShas: ["c"] }
  ]);
  assert.deepEqual(ordered.map(function (commit) { return commit.sha; }), ["a", "b", "c"]);
});

test("this branch drops commits that are not ancestors of the tip", function () {
  var commits = [
    { sha: "a", parentShas: ["b"] },
    { sha: "d", parentShas: ["b"] },
    { sha: "b", parentShas: [] }
  ];
  assert.deepEqual(model.filterScope(commits, "branch", "a").map(function (commit) { return commit.sha; }), ["a", "b"]);
  assert.equal(model.filterScope(commits, "all", "a").length, 3);
});

test("status and time copy", function () {
  assert.equal(model.statusText({ loading: true }), "Loading commits…");
  assert.equal(model.statusText({
    commits: [{ sha: "a" }],
    scope: "branch",
    branch: "main"
  }), "1 commit on main");
  assert.equal(model.statusText({
    commits: [{ sha: "a" }, { sha: "b" }],
    scope: "all"
  }), "2 commits across branches");
  assert.equal(model.statusText({
    commits: [{ sha: "a" }, { sha: "b" }],
    query: "zz",
    matchCount: 0
  }), "No matches in loaded commits");
  assert.equal(model.statusText({
    commits: new Array(3),
    totalCount: 10482,
    scope: "branch",
    branch: "main"
  }), "Showing 3 of 10,482 commits on main");
  var now = Date.parse("2026-11-26T12:00:00Z");
  assert.equal(model.relativeTime("2026-11-25T12:00:00Z", now), "yesterday");
  assert.equal(model.relativeTime("2026-11-26T10:00:00Z", now), "2 hours ago");
  assert.equal(model.absoluteTime("2012-03-06T23:06:50Z"), "6 Mar 2012, 23:06 UTC");
});

test("layout draws a merge into two columns", function () {
  var laid = layout.layoutGraph([
    { sha: "m", parentShas: ["a", "b"] },
    { sha: "a", parentShas: ["c"] },
    { sha: "b", parentShas: ["c"] },
    { sha: "c", parentShas: [] }
  ]);
  assert.equal(laid.maxCols, 2);
  assert.equal(laid.rows[0].col, 0);
  assert.equal(laid.rows[0].isMerge, true);
  assert.equal(laid.rows[0].links.length, 2);
  assert.equal(laid.rows[2].col, 1);
  assert.deepEqual(laid.rows[2].links[0], { from: 1, to: 0 });
  assert.equal(laid.rows[3].col, 0);
});

test("glyph marks the current tip and a merge diamond", function () {
  var straight = glyph.glyphMarkup({
    col: 0, cameFromAbove: false, isMerge: false, extraParents: 0,
    before: ["a"], after: ["b"], links: [{ from: 0, to: 0 }]
  }, 1, true);
  assert.match(straight, /<circle /);
  assert.match(straight, /fill="var\(--gwg-lane-0\)"/);
  var merge = glyph.glyphMarkup({
    col: 0, cameFromAbove: true, isMerge: true, extraParents: 2,
    before: ["m", "x"], after: ["a", "b"],
    links: [{ from: 0, to: 0 }, { from: 0, to: 1 }]
  }, 2, false);
  assert.match(merge, /rotate\(45 /);
  assert.match(merge, /C 12 26, 28 24, 28 32/);
  assert.match(merge, />\+2</);
});

test("loadGraph merges another branch tip and pages the selected ref", async function () {
  var calls = [];
  async function fetchImpl(url) {
    calls.push(url);
    if (url.indexOf("/branches") !== -1) {
      return {
        ok: true,
        status: 200,
        text: JSON.stringify([
          { name: "main", commit: { sha: "aaa" } },
          { name: "dev", commit: { sha: "ddd" } }
        ]),
        headers: {}
      };
    }
    if (url.indexOf("sha=dev") !== -1) {
      return {
        ok: true,
        status: 200,
        text: JSON.stringify([rawCommit("ddd", "2024-05-02T00:00:00Z", ["bbb"], "dev tip")]),
        headers: {}
      };
    }
    if (url.indexOf("page=2") !== -1) {
      return {
        ok: true,
        status: 200,
        text: JSON.stringify([rawCommit("ccc", "2024-04-01T00:00:00Z", [], "older")]),
        headers: {}
      };
    }
    return {
      ok: true,
      status: 200,
      text: JSON.stringify([
        rawCommit("aaa", "2024-05-01T00:00:00Z", ["bbb"], "tip"),
        rawCommit("bbb", "2024-04-02T00:00:00Z", [], "base")
      ]),
      headers: { link: '<https://api.github.com/repos/octo/repo/commits?page=2>; rel="next"' }
    };
  }

  var page = await github.loadGraph({
    fetchImpl: fetchImpl,
    owner: "octo",
    repo: "repo",
    ref: "main",
    token: ""
  });
  assert.deepEqual(page.commits.map(function (commit) { return commit.sha; }), ["ddd", "aaa", "bbb"]);
  assert.equal(page.branchTip, "aaa");
  assert.equal(page.refs.length, 2);
  assert.equal(page.refs[0].kind, "branch");
  assert.equal(page.nextCursor, "https://api.github.com/repos/octo/repo/commits?page=2");

  var older = await github.loadGraph({
    fetchImpl: fetchImpl,
    owner: "octo",
    repo: "repo",
    ref: "main",
    cursor: page.nextCursor,
    previous: page
  });
  assert.deepEqual(older.commits.map(function (commit) { return commit.sha; }), ["ddd", "aaa", "bbb", "ccc"]);
  assert.equal(older.branchTip, "aaa");
  assert.ok(calls.some(function (url) { return url.indexOf("/branches") !== -1; }));
});

test("empty repository and rate limit", async function () {
  var empty = await github.loadGraph({
    fetchImpl: async function (url) {
      if (url.indexOf("/branches") !== -1) return { ok: true, status: 200, text: "[]", headers: {} };
      return { ok: false, status: 409, text: "{\"message\":\"Git Repository is empty.\"}", headers: {} };
    },
    owner: "octo",
    repo: "empty",
    ref: "main"
  });
  assert.deepEqual(empty.commits, []);
  assert.equal(empty.branchTip, null);

  await assert.rejects(function () {
    return github.loadGraph({
      fetchImpl: async function () {
        return {
          ok: false,
          status: 403,
          text: "{\"message\":\"API rate limit exceeded\"}",
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000" }
        };
      },
      owner: "octo",
      repo: "repo",
      ref: "main"
    });
  }, function (err) { return err.kind === "rate_limit"; });
});
