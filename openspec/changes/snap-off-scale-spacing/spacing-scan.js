const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = process.cwd();
const files = execSync("find . -name '*.css' -not -path '*/node_modules/*'", {cwd: root}).toString().trim().split('\n').filter(Boolean);

// Space scale tokens (px values) - read from theme.css
const themeCss = fs.readFileSync(path.join(root, 'theme/theme.css'), 'utf8');
const spaceTokens = {};
for (const m of themeCss.matchAll(/--space-([\w-]+):\s*([\d.]+)(px|rem)/g)) {
  const val = m[3] === 'rem' ? parseFloat(m[2]) * 16 : parseFloat(m[2]);
  spaceTokens[m[1]] = val;
}
console.error('space tokens (px):', JSON.stringify(spaceTokens));

const results = [];
const declRe = /(margin|padding|gap)(-[a-z]+)?\s*:\s*([^;]+);/g;

for (const rel of files) {
  const full = path.join(root, rel);
  const text = fs.readFileSync(full, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    // must contain margin/padding/gap prop
    const m = line.match(/(margin|padding|gap)(-[a-z]+)?\s*:\s*([^;]+);?/);
    if (!m) return;
    let body = m[3];
    // if declaration doesn't end with ; on this line, need to handle multi-line - skip for now, flag
    if (!line.includes(';')) {
      results.push({file: rel, line: idx+1, note: 'MULTILINE-DECL-NEEDS-MANUAL-CHECK', raw: line.trim()});
      return;
    }
    // strip var(--space-N) occurrences
    const stripped = body.replace(/var\(--space-[\w-]+\)/g, '').replace(/var\([^)]*\)/g, ' ');
    // find literal px/rem values
    const litRe = /(\d+(?:\.\d+)?)(px|rem|em|%)/g;
    let lm;
    while ((lm = litRe.exec(stripped)) !== null) {
      const num = parseFloat(lm[1]);
      const unit = lm[2];
      let px = unit === 'px' ? num : unit === 'rem' ? num * 16 : null;
      // check if it matches a space token exactly
      let matchesToken = false;
      if (px !== null) {
        for (const k in spaceTokens) { if (Math.abs(spaceTokens[k] - px) < 0.01) matchesToken = true; }
      }
      if (unit === 'em' || unit === '%') {
        results.push({file: rel, line: idx+1, value: lm[0], px: null, matchesToken: false, relative: true, raw: line.trim()});
      } else if (!matchesToken) {
        results.push({file: rel, line: idx+1, value: lm[0], px, matchesToken, relative: false, raw: line.trim()});
      }
    }
  });
}

fs.writeFileSync('/tmp/spacing-scan-results.json', JSON.stringify(results, null, 2));
console.error('total hits:', results.length);
