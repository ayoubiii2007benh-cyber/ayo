#!/bin/bash
# usage: lh.sh <url> <label> <runs>   -> writes <label>-{mobile,desktop}-N.json into scratchpad/lh/
URL="$1"; LABEL="$2"; RUNS="${3:-3}"
OUT="${LH_OUT:-./lh-results}"
mkdir -p "$OUT"
for form in mobile desktop; do
  for i in $(seq 1 "$RUNS"); do
    EXTRA=""
    [ "$form" = "desktop" ] && EXTRA="--preset=desktop"
    npx --yes lighthouse "$URL" $EXTRA --only-categories=performance --output=json --output-path="$OUT/$LABEL-$form-$i.json" \
      --chrome-flags="--headless=new --no-sandbox" --quiet >/dev/null 2>&1 || echo "run failed: $form $i"
  done
done
echo done
