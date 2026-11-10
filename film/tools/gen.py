#!/usr/bin/env python3
"""Open House film v2: writes scenes/cNN-*.html from the shared booth pieces below plus each scene's own markup and
timeline (tools/scenes_v2.py). Run: python3 tools/gen.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from scenes_v2 import SCENES  # noqa: E402
from scenes_v2b import SCENES2  # noqa: E402
SCENES = SCENES + SCENES2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PAGE = """<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body>
<template>
  <style>
{css}
  </style>
  <div id="{id}-root" class="oh" data-composition-id="{id}" data-width="1920" data-height="1080" data-duration="{dur}">
    <div id="{id}-ground" class="oh-ground clip" data-start="0" data-duration="{dur}" data-track-index="0" style="background:{ground}"></div>
    <div id="{id}-world" class="oh-world">
{html}
    </div>
  </div>
  <script>
    (() => {{
      const $ = (i) => document.getElementById(i);
      const tl = gsap.timeline({{ paused: true }});
      const E = OH.E;
      const at0 = (els) => tl.set(els, {{ opacity: 0 }}, 0);
{js}
      tl.set({{}}, {{}}, {dur});
      window.__timelines["{id}"] = tl;
    }})();
  </script>
</template>
</body>
</html>
"""

for sc in SCENES:
    css = "\n".join(f'    [data-composition-id="{sc["id"]}"] {line}' for line in sc["css"].strip().splitlines() if line.strip())
    out = PAGE.format(id=sc["id"], dur=sc["dur"], ground=sc["ground"], css=css, html=sc["html"], js=sc["js"])
    path = os.path.join(ROOT, "scenes", f'{sc["id"]}-{sc["name"]}.html')
    open(path, "w").write(out)
    print("wrote", os.path.relpath(path, ROOT))
