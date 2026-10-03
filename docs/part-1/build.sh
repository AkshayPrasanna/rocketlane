#!/bin/sh
# Builds the PDF and the Word copy from part-1-requirements-analysis.html.
# The PDF uses CSS borders only. The Word copy keeps the HTML border attributes that
# LibreOffice needs to draw table lines, and has the diagrams embedded as data URIs.
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT="Part-1_Requirements-and-Workflow-Analysis"

sed -E 's/ border="1" cellspacing="0" cellpadding="[0-9]+"//' part-1-requirements-analysis.html > .print.html
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$OUT.pdf" "file://$PWD/.print.html" >/dev/null 2>&1
rm -f .print.html
echo "wrote $OUT.pdf"

if command -v soffice >/dev/null 2>&1; then
  python3 - <<'PY'
import base64, re
s = open("part-1-requirements-analysis.html").read()
def inline(m):
    data = base64.b64encode(open(m.group(1), "rb").read()).decode()
    return f'src="data:image/png;base64,{data}"'
open("part-1-word.html", "w").write(re.sub(r'src="(figures/[^"]+\.png)"', inline, s))
PY
  rm -rf .docx-build && mkdir .docx-build
  soffice --headless --infilter="HTML (StarWriter)" --convert-to docx:"MS Word 2007 XML" --outdir .docx-build part-1-word.html >/dev/null 2>&1
  mv .docx-build/part-1-word.docx "$OUT.docx"
  rm -rf .docx-build part-1-word.html
  echo "wrote $OUT.docx"
fi
