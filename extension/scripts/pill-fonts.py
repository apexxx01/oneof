"""
Regenerates the two tiny fonts the in-page pill uses (extension/src/content/fonts/). They are
static instances of the self-hosted variable fonts, subset to the characters the pill prints, so
they can be inlined into content.js (no font file is fetched from the page: page CSPs and the
extension's own no-network rule both hold).

    python3 extension/scripts/pill-fonts.py      (needs fonttools + brotli)
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

root = Path(__file__).resolve().parents[2]
nm = root / 'node_modules' / '@fontsource-variable'
out = root / 'extension' / 'src' / 'content' / 'fonts'
out.mkdir(parents=True, exist_ok=True)

def make(src, axes, text, dest):
    f = TTFont(src)
    f = instantiateVariableFont(f, axes)
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['kern', 'tnum']
    opts.name_IDs = []
    opts.notdef_outline = True
    s = subset.Subsetter(opts)
    s.populate(text=text)
    s.subset(f)
    f.flavor = 'woff2'
    f.save(dest)
    print(dest, dest.stat().st_size, 'bytes')

make(nm / 'big-shoulders' / 'files' / 'big-shoulders-latin-opsz-normal.woff2', {'wght': 900, 'opsz': 72},
     '0123456789~kMB.,-/ ', out / 'pill-numeral.woff2')
ascii_ = ''.join(chr(c) for c in range(0x20, 0x7f))
make(nm / 'martian-mono' / 'files' / 'martian-mono-latin-wdth-normal.woff2', {'wght': 700, 'wdth': 87.5},
     ascii_ + '·→–…×’', out / 'pill-mono.woff2')
