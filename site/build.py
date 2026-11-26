"""Build the Editlayer marketing site: src/pages/*.html + shared head/foot -> directory URLs in this folder.

Each page starts with comment metadata: title, desc, path, nav, optional og_title and noindex.
Then: sitemap.xml, robots.txt, the PWA (pwa.py), and Editlayer marks the editable regions (annotate).
Run:  python build.py
"""
import hashlib, html, os, re, shutil, subprocess, sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
BASE = os.environ.get("SITE_BASE", "https://editlayer.co")
NAV = ["home", "features", "ai", "developers", "pricing", "access"]
HIDDEN = ("/404.html", "/offline/", "/editlayer-blocks.html")  # never in the sitemap

head = (SRC / "_head.html").read_text(encoding="utf-8")
foot = (SRC / "_foot.html").read_text(encoding="utf-8")
partials = {p.stem.lstrip("_"): p.read_text(encoding="utf-8") for p in (SRC / "partials").glob("*.html")}
esc = html.escape
version = hashlib.sha1(((ROOT / "styles.css").read_bytes() + (ROOT / "script.js").read_bytes())).hexdigest()[:8]


def render(body: str) -> str:
    for name, text in partials.items():
        if name != "jsonld":
            body = body.replace("{{%s}}" % name, text)
    return body.replace("{{year}}", str(date.today().year))


def out_path(path: str) -> Path:
    if path == "/":
        return ROOT / "index.html"
    if path.endswith(".html"):
        return ROOT / path.lstrip("/")
    return ROOT / path.strip("/") / "index.html"


sitemap = []
for page in sorted((SRC / "pages").glob("*.html")):
    body = page.read_text(encoding="utf-8")
    meta = dict(re.findall(r"<!--\s*(\w+):\s*(.*?)\s*-->", body))
    body = re.sub(r"^(\s*<!--.*?-->\s*)+", "", body)
    path = meta["path"]
    url = BASE + path
    page_head = head
    values = {"title": meta["title"], "desc": meta["desc"], "og_title": meta.get("og_title", meta["title"]),
              "canonical": url, "base": BASE, "v": version}
    for key, val in values.items():
        page_head = page_head.replace("{{%s}}" % key, esc(val))
    page_head = page_head.replace("{{jsonld}}", partials["jsonld"] if path == "/" else "")
    if meta.get("noindex"):
        page_head = page_head.replace("<title>", '<meta name="robots" content="noindex">\n<title>', 1)
    for key in NAV:
        page_head = page_head.replace("{{nav:%s}}" % key, ' aria-current="page"' if meta.get("nav") == key else "")
    target = out_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(page_head + render(body) + foot.replace("{{year}}", str(date.today().year)).replace("{{v}}", version),
                      encoding="utf-8")
    if path not in HIDDEN:
        sitemap.append(url)
    print("built", path)

(ROOT / "sitemap.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "".join(f"  <url><loc>{u}</loc><lastmod>{date.today()}</lastmod></url>\n" for u in sitemap)
    + "</urlset>\n", encoding="utf-8")
(ROOT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nDisallow: /_cms/\n\nSitemap: {BASE}/sitemap.xml\n", encoding="utf-8")
print(f"sitemap: {len(sitemap)} urls")

# Installable PWA (modern-website skill).
pwa = Path.home() / ".claude/skills/modern-website/scripts/pwa.py"
if pwa.exists():
    cmd = [sys.executable, str(pwa), str(ROOT), "--name", "Editlayer", "--short", "Editlayer", "--theme", "#121316",
           "--bg", "#121316", "--desc", "The click-to-edit layer for websites built with AI.",
           "--shortcut", "Features=/features/", "--shortcut", "Developers=/developers/"]
    icon = ROOT / "assets" / "img" / "mark-1024.png"
    if icon.exists():
        cmd += ["--icon", str(icon)]
    subprocess.run(cmd, check=True)

# Editlayer: mark the editable regions. This site dogfoods the engine in ../engine (or EDITLAYER_HOME).
cli = Path(os.environ.get("EDITLAYER_HOME", ROOT.parent / "engine")) / "cli" / "editlayer.mjs"
if not cli.exists():
    cli = ROOT / "_editlayer" / "cli" / "editlayer.mjs"
if cli.exists() and shutil.which("node"):
    subprocess.run(["node", str(cli), "annotate", str(ROOT)], check=True)
else:
    print("warning: Editlayer CLI not found; pages are not marked for the editor")
