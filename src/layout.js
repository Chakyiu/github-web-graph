/* Lane assignment ported from the UX reference. Newest commit first.
   The first parent keeps the column. An extra parent joins a column that
   already holds that sha, else the first empty column, else a new column.
   At most two extra parents are drawn. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GWGLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var MAX_DRAWN_PARENTS = 3;

  function layoutGraph(commits) {
    var rows = [];
    var active = [];

    for (var c = 0; c < commits.length; c++) {
      var commit = commits[c];
      var parents = commit.parentShas || [];
      var cameFromAbove = active.indexOf(commit.sha) !== -1;
      var before = active.slice();
      var col = before.indexOf(commit.sha);
      if (col === -1) {
        col = before.length;
        before.push(commit.sha);
      }

      var after = before.slice();
      var links = [];

      if (parents.length === 0) {
        after[col] = null;
      } else {
        after[col] = parents[0];
        var parentLink = { from: col, to: col };
        var prior = -1;
        for (var p = 0; p < before.length; p++) {
          if (p !== col && before[p] === parents[0]) prior = p;
        }
        if (prior !== -1) {
          after[col] = null;
          parentLink = { from: col, to: prior };
        }
        links.push(parentLink);

        var cap = Math.min(parents.length, MAX_DRAWN_PARENTS);
        for (var i = 1; i < cap; i++) {
          var parentSha = parents[i];
          var target = -1;
          for (var t = 0; t < after.length; t++) {
            if (t !== col && after[t] === parentSha) target = t;
          }
          if (target === -1) {
            for (var h = 0; h < after.length; h++) {
              if (h !== col && after[h] == null) {
                target = h;
                break;
              }
            }
            if (target === -1) {
              after.push(parentSha);
              target = after.length - 1;
            } else {
              after[target] = parentSha;
            }
          }
          links.push({ from: col, to: target });
        }
      }

      while (after.length && after[after.length - 1] == null) after.pop();

      rows.push({
        sha: commit.sha,
        col: col,
        cameFromAbove: cameFromAbove,
        isMerge: parents.length > 1,
        extraParents: Math.max(0, parents.length - MAX_DRAWN_PARENTS),
        before: before,
        after: after.slice(),
        links: links
      });
      active = after.slice();
    }

    var maxCols = 1;
    for (var r = 0; r < rows.length; r++) {
      maxCols = Math.max(maxCols, rows[r].before.length, rows[r].after.length, rows[r].col + 1);
    }
    return { rows: rows, maxCols: maxCols };
  }

  return { layoutGraph: layoutGraph, MAX_DRAWN_PARENTS: MAX_DRAWN_PARENTS };
});
