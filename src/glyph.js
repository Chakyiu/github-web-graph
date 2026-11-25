/* SVG for one commit row. Markup is numbers and our own CSS variables. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GWGGlyph = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var ROW_H = 32;
  var LANE_GAP = 16;
  var LANE_PAD = 12;

  function laneColor(index) {
    return "var(--gwg-lane-" + ((index % 6) + 6) % 6 + ")";
  }

  function xOf(index) {
    return LANE_PAD + index * LANE_GAP;
  }

  function glyphMarkup(row, maxCols, isTip) {
    var cols = Math.max(1, maxCols || 1);
    var width = LANE_PAD + Math.max(0, cols - 1) * LANE_GAP + LANE_PAD + (row.extraParents ? 24 : 0);
    var mid = ROW_H / 2;
    var parts = [];
    var i;
    for (i = 0; i < (row.before || []).length; i++) {
      if (!row.before[i] || i === row.col) continue;
      if (row.after[i] === row.before[i]) {
        parts.push("<line x1=\"" + xOf(i) + "\" y1=\"0\" x2=\"" + xOf(i) + "\" y2=\"" + ROW_H + "\" stroke=\"" + laneColor(i) + "\" stroke-width=\"2\"></line>");
      }
    }
    if (row.cameFromAbove) {
      parts.push("<line x1=\"" + xOf(row.col) + "\" y1=\"0\" x2=\"" + xOf(row.col) + "\" y2=\"" + mid + "\" stroke=\"" + laneColor(row.col) + "\" stroke-width=\"2\"></line>");
    }
    (row.links || []).forEach(function (link) {
      var color = laneColor(link.to);
      var x1 = xOf(link.from);
      var x2 = xOf(link.to);
      if (link.from === link.to) {
        parts.push("<line x1=\"" + x1 + "\" y1=\"" + mid + "\" x2=\"" + x2 + "\" y2=\"" + ROW_H + "\" stroke=\"" + color + "\" stroke-width=\"2\"></line>");
        return;
      }
      var d = "M " + x1 + " " + mid + " C " + x1 + " " + (mid + 10) + ", " + x2 + " " + (ROW_H - 8) + ", " + x2 + " " + ROW_H;
      parts.push("<path d=\"" + d + "\" fill=\"none\" stroke=\"" + color + "\" stroke-width=\"2\"></path>");
    });
    var cx = xOf(row.col);
    var color = laneColor(row.col);
    var fill = isTip ? color : "var(--gwg-node-fill)";
    if (row.isMerge) {
      parts.push("<rect x=\"" + (cx - 4) + "\" y=\"" + (mid - 4) + "\" width=\"8\" height=\"8\" transform=\"rotate(45 " + cx + " " + mid + ")\" fill=\"" + fill + "\" stroke=\"" + color + "\" stroke-width=\"2\"></rect>");
    } else {
      parts.push("<circle cx=\"" + cx + "\" cy=\"" + mid + "\" r=\"4.5\" fill=\"" + fill + "\" stroke=\"" + color + "\" stroke-width=\"2\"></circle>");
    }
    if (row.extraParents > 0) {
      parts.push("<text x=\"" + (cx + 10) + "\" y=\"" + (mid + 4) + "\" fill=\"var(--fgColor-muted)\" font-size=\"12\" font-family=\"var(--mono)\">+" + Number(row.extraParents) + "</text>");
    }
    return "<svg class=\"glyph\" width=\"" + width + "\" height=\"" + ROW_H + "\" viewBox=\"0 0 " + width + " " + ROW_H + "\" aria-hidden=\"true\">" + parts.join("") + "</svg>";
  }

  function laneWidth(maxCols, extra) {
    var cols = Math.max(1, maxCols || 1);
    return LANE_PAD + Math.max(0, cols - 1) * LANE_GAP + LANE_PAD + (extra ? 24 : 0);
  }

  return { glyphMarkup: glyphMarkup, laneWidth: laneWidth, laneColor: laneColor };
});
