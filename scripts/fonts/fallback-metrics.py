#!/usr/bin/env python3
"""Derive the metric-matched fallback @font-face blocks in frontend/src/theme/theme.css (HEL-1678).

Dev-only (needs fontTools + brotli-free TTF download; never run in CI, CI has no network).

  python3 scripts/fonts/fallback-metrics.py \
      --liberation-dir /usr/share/fonts/liberation \
      --dejavu-dir /path/to/dir/with/DejaVu*.ttf \
      [--weight 400]

What it does
  1. Fetches the Google Fonts CSS the app uses (UA-less request, so Google answers with one full static TTF per weight) and
     downloads the requested-weight file of Schibsted Grotesk, JetBrains Mono and Fraunces. The URLs and the fetch
     date are printed first.
  2. Uses the static instance Google serves for the requested weight.
  3. For each fallback face: size-adjust = web average advance / fallback average advance, where the average is
     weighted by English letter frequency (plus the space), the capsize / Next.js method;
     ascent-override = web ascent / upm / size-adjust, descent-override and line-gap-override likewise.
     Ascent/descent/line-gap are hhea, or OS/2 typo when fsSelection USE_TYPO_METRICS (bit 7) is set, which is what
     Chromium's Skia/FreeType path reads.
  4. Prints one @font-face block per fallback, ready to paste into theme.css.

The Arial-family numbers come from Liberation (metric-compatible with Arial, Arimo, Cousine, Tinos), so one number
serves every `local()` name in that face. The DejaVu face is a separate family because DejaVu is much wider.
Values are then checked in a real browser (openspec/changes/metric-matched-fallback-fonts/evidence/tools/boxmatch.mjs).
The two Fraunces faces carry an empirical size-adjust tune (TUNED_SIZE_ADJUST below, with its reason); the script
prints exactly the numbers committed in theme.css.
"""
import argparse, datetime, io, os, re, sys, urllib.request

from fontTools.ttLib import TTFont

CSS_URL = (
    "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700"
    "&family=Schibsted+Grotesk:wght@400..900&family=JetBrains+Mono:wght@400;600"
)

# English letter frequencies (percent) and a space share of ~18% of running text.
FREQ = {
    "e": 12.7, "t": 9.06, "a": 8.17, "o": 7.51, "i": 6.97, "n": 6.75, "s": 6.33, "h": 6.09, "r": 5.99,
    "d": 4.25, "l": 4.03, "c": 2.78, "u": 2.76, "m": 2.41, "w": 2.36, "f": 2.23, "g": 2.02, "y": 1.97,
    "p": 1.93, "b": 1.49, "v": 0.98, "k": 0.77, "j": 0.15, "x": 0.15, "q": 0.1, "z": 0.07,
}
WEIGHTED = {c: f * 0.82 for c, f in FREQ.items()}
WEIGHTED[" "] = 18.0


def fetch(url, binary=True):
    req = urllib.request.Request(url, headers={"User-Agent": ""})
    data = urllib.request.urlopen(req, timeout=60).read()
    return data if binary else data.decode()


def weight_urls(css, weight):
    """Without a User-Agent Google answers with one static TTF per family and weight (no subset comments)."""
    out = {}
    for m in re.finditer(r"@font-face \{(.*?)\}", css, re.S):
        body = m.group(1)
        fam = re.search(r"font-family: '([^']+)'", body).group(1)
        w = int(re.search(r"font-weight: (\d+)", body).group(1))
        url = re.search(r"url\(([^)]+)\)", body).group(1)
        if w == weight:
            out.setdefault(fam, url)
    return out


def load(data_or_path):
    return TTFont(io.BytesIO(data_or_path) if isinstance(data_or_path, bytes) else data_or_path)


def metrics(f):
    upm = f["head"].unitsPerEm
    os2 = f["OS/2"]
    if os2.fsSelection & (1 << 7):
        a, d, g = os2.sTypoAscender, -os2.sTypoDescender, os2.sTypoLineGap
    else:
        a, d, g = f["hhea"].ascent, -f["hhea"].descent, f["hhea"].lineGap
    return a / upm, d / upm, g / upm


def avg_width(f):
    cmap = f.getBestCmap()
    hmtx = f["hmtx"]
    upm = f["head"].unitsPerEm
    total = sum(WEIGHTED.values())
    acc = 0.0
    for ch, w in WEIGHTED.items():
        acc += w * hmtx[cmap[ord(ch)]][0] / upm
    return acc / total


# Empirical size-adjust tunes (HEL-1678), applied on top of the derived ratio. The letter-frequency average
# over-sizes the Fraunces fallbacks: measured in Chromium (evidence/boxmatch-ci.json, three sizes, two samples,
# weights 400 and 600 averaged) the derived Times face was 3.6% / 0.3% wide (400 / 600) and the derived DejaVu
# face 2.8% / -0.5%, so the tuned numbers below sit between the two weights. Only meaningful at the default 400
# derivation (--weight 400); the vertical overrides are recomputed from the tuned size-adjust.
TUNED_SIZE_ADJUST = {
    "Fraunces Fallback Times": 1.1390,
    "Fraunces Fallback DejaVu": 0.8970,
}


def block(name, sources, web, fb, weight=400):
    wa, wd, wg = metrics(web)
    size = avg_width(web) / avg_width(fb)
    if name in TUNED_SIZE_ADJUST and weight == 400:
        size = TUNED_SIZE_ADJUST[name]
    pct = lambda v: f"{v * 100:.2f}%"
    return (
        f"@font-face {{\n  font-family: \"{name}\";\n  src: {sources};\n"
        f"  size-adjust: {pct(size)};\n  ascent-override: {pct(wa / size)};\n"
        f"  descent-override: {pct(wd / size)};\n  line-gap-override: {pct(wg / size)};\n}}",
        size,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--liberation-dir", required=True)
    ap.add_argument("--dejavu-dir", required=True)
    ap.add_argument("--weight", type=int, default=400, help="CSS weight of the web font instance (400 or 600)")
    a = ap.parse_args()

    print(f"/* fetched {datetime.date.today().isoformat()} from {CSS_URL} */")
    urls = weight_urls(fetch(CSS_URL, binary=False), a.weight)
    for fam, u in urls.items():
        print(f"/* {fam}: {u} */")
    print(f"/* static instances at weight {a.weight} as served to a UA-less request; Fraunces opsz is whatever that instance carries */")
    sch = load(fetch(urls["Schibsted Grotesk"]))
    jbm = load(fetch(urls["JetBrains Mono"]))
    fra = load(fetch(urls["Fraunces"]))
    lib = lambda n: load(os.path.join(a.liberation_dir, n))
    dej = lambda n: load(os.path.join(a.dejavu_dir, n))
    plan = [
        ("Schibsted Grotesk Fallback Arial", 'local("Arial"), local("ArialMT"), local("Liberation Sans"), local("LiberationSans"), local("Arimo")', sch, lib("LiberationSans-Regular.ttf")),
        ("Schibsted Grotesk Fallback DejaVu", 'local("DejaVu Sans"), local("DejaVuSans")', sch, dej("DejaVuSans.ttf")),
        ("JetBrains Mono Fallback Courier", 'local("Courier New"), local("CourierNewPSMT"), local("Liberation Mono"), local("LiberationMono"), local("Cousine")', jbm, lib("LiberationMono-Regular.ttf")),
        ("JetBrains Mono Fallback DejaVu", 'local("DejaVu Sans Mono"), local("DejaVuSansMono")', jbm, dej("DejaVuSansMono.ttf")),
        ("Fraunces Fallback Times", 'local("Times New Roman"), local("TimesNewRomanPSMT"), local("Liberation Serif"), local("LiberationSerif"), local("Tinos")', fra, lib("LiberationSerif-Regular.ttf")),
        ("Fraunces Fallback DejaVu", 'local("DejaVu Serif"), local("DejaVuSerif")', fra, dej("DejaVuSerif.ttf")),
    ]
    for name, src, web, fb in plan:
        text, size = block(name, src, web, fb, a.weight)
        print(f"\n/* {name}: size-adjust {size:.4f} */\n{text}")


if __name__ == "__main__":
    sys.exit(main())
