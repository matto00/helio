# HEL-1263 measure-after

Method: for every zrender text element of each chart (via echarts.getInstanceByDom on the running app, dev 6695), `style.fill` is read, and the element's rect is screenshotted (DPR 2). Background = most common pixel in that rect; painted colour = the pixel farthest from it (glyph antialiasing means this is a lower bound on the true contrast). Ratio = WCAG relative-luminance ratio. Threshold: WCAG 2.x SC 1.4.3 AA, 4.5:1 (normal text).

| theme | kind | text | fill(s) (zrender) | painted colour(s) | background | min painted ratio | max painted ratio | >= 4.5 |
|---|---|---|---|---|---|---|---|---|
| dark | bar | axis name | #f2efe9 | #f2efe9 | #1a1816 | 15.43 | 15.43 | PASS |
| dark | bar | axis tick label | #f2efe9 | #f2efe9 | #1a1816 | 15.43 | 15.43 | PASS |
| dark | bar | legend | #f2efe9 | #f2efe9 | #1a1816 | 15.43 | 15.43 | PASS |
| dark | line | axis name | #f2efe9 | #f2efe9 | #1a1816 | 15.43 | 15.43 | PASS |
| dark | line | axis tick label | #f2efe9 | #f2efe9 | #1a1816 | 15.43 | 15.43 | PASS |
| dark | line | legend | #f2efe9 | #f2efe9 | #1a1816 | 15.43 | 15.43 | PASS |
| dark | pie | pie legend | #f2efe9 | #f2efe9 | #1a1816 | 15.43 | 15.43 | PASS |
| dark | pie | pie slice label | #333 | #1a1816 | #ffffff | 17.7 | 17.7 | PASS |
| dark | scatter | axis name | #f2efe9 | #f2efe9 | #1a1816 | 15.43 | 15.43 | PASS |
| dark | scatter | axis tick label | #f2efe9 | #f2efe9 | #1a1816 | 15.43 | 15.43 | PASS |
| dark | tinted-line | axis name | #f2efe9 | #f2efe9 | #514611 | 8.19 | 8.19 | PASS |
| dark | tinted-line | axis tick label | #f2efe9 | #f2efe9 | #514611 | 8.19 | 8.19 | PASS |
| dark | tinted-line | legend | #f2efe9 | #f2efe9 | #514611 | 8.19 | 8.19 | PASS |
| light | bar | axis name | #211d19 | #211d19 | #fdfcfa | 16.33 | 16.33 | PASS |
| light | bar | axis tick label | #211d19 | #211d19 | #fdfcfa | 16.33 | 16.33 | PASS |
| light | bar | legend | #211d19 | #211d19 | #fdfcfa | 16.33 | 16.33 | PASS |
| light | line | axis name | #211d19 | #211d19 | #fdfcfa | 16.33 | 16.33 | PASS |
| light | line | axis tick label | #211d19 | #211d19 | #fdfcfa | 16.33 | 16.33 | PASS |
| light | line | legend | #211d19 | #211d19 | #fdfcfa | 16.33 | 16.33 | PASS |
| light | pie | pie legend | #211d19 | #211d19 | #fdfcfa | 16.33 | 16.33 | PASS |
| light | pie | pie slice label | #333 | #333333 | #ffffff | 12.63 | 12.63 | PASS |
| light | scatter | axis name | #211d19 | #211d19 | #fdfcfa | 16.33 | 16.33 | PASS |
| light | scatter | axis tick label | #211d19 | #211d19 | #fdfcfa | 16.33 | 16.33 | PASS |
| light | tinted-line | axis name | #211d19 | #211d19 | #fdf3be | 14.94 | 14.94 | PASS |
| light | tinted-line | axis tick label | #211d19 | #211d19 | #fdf3be | 14.94 | 14.94 | PASS |
| light | tinted-line | legend | #211d19 | #211d19 | #fdf3be | 14.94 | 14.94 | PASS |

## Findings (after)

Every axis tick label, axis name and legend entry (line, bar, scatter, pie; light and dark; plus the dark and light tinted-background panel) now has `style.fill` equal to the live `--app-text` (`#f2efe9` dark, `#211d19` light), measuring 15.43 (dark), 16.33 (light), 8.19 (dark tinted) and 14.94 (light tinted) against the panel surface, all above the 4.5:1 SC 1.4.3 AA threshold. Compare row-for-row with measure-before.md: the pre-change failures were dark axes (1.19), light line legend (1.03), bar and pie legends, and the dark tinted axes (2.23). Axis text in light theme and the dark line legend were already passing before. Pie slice labels are unchanged (ECharts default, out of scope).
