#!/usr/bin/env bash
# verify-release.sh — verify a published @chio/openclaw release.
#
# The openclaw release ships TWO artefacts bound to the same git tag:
#   npm:    @chio/openclaw (tarball on npmjs.org, SLSA L3 via npm --provenance)
#   docker: ghcr.io/<owner>/chio-openclaw:<tag> (OCI image signed with cosign)
#
# Usage:
#   scripts/verify-release.sh <version>                   # default: npm
#   scripts/verify-release.sh --type npm <version>
#   scripts/verify-release.sh --type docker <version>
#   CHIO_DRY_RUN=true scripts/verify-release.sh <version> [<fixture>]
#
# Checks (npm mode):
#   - npm audit signatures
#   - slsa-verifier verify-npm-package
#
# Checks (docker mode):
#   - cosign verify (keyless OIDC signer regex)
#   - slsa-verifier verify-image
#
# Required tools:
#   npm >= 9.5, slsa-verifier   (npm mode)
#   cosign, slsa-verifier, docker / crane (docker mode)
#
# Dry-run mode (CHIO_DRY_RUN=true) skips network calls; useful for syntax
# checking and CI shimming.

set -euo pipefail

SOURCE_REPO="${CHIO_GH_OWNER:-owner}/chio-open-claw-plugin"
HERE="$(cd "$(dirname "$0")" && pwd)"

TYPE="npm"
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --type) TYPE="${2:-}"; shift 2 ;;
    --type=*) TYPE="${1#--type=}"; shift ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--type npm|docker] <version> [<fixture>]

Defaults to --type npm. With --type docker, verifies the GHCR image instead.
EOF
      exit 0
      ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done
set -- "${POSITIONAL[@]:-}"

VERSION="${1:-}"
FIXTURE="${2:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 [--type npm|docker] <version> [<fixture>]" >&2
  exit 1
fi

# Locate the shared library.
LIB=""
for candidate in \
  "$HERE/verify-release-lib.sh" \
  "$HERE/../../chio-ci-actions/scripts/verify-release-lib.sh" \
  "/usr/local/lib/chio/verify-release-lib.sh"; do
  if [[ -f "$candidate" ]]; then LIB="$candidate"; break; fi
done
if [[ -z "$LIB" ]]; then
  echo "ERROR: chio-ci-actions/scripts/verify-release-lib.sh not found" >&2
  exit 2
fi
# shellcheck disable=SC1090
source "$LIB"

case "$TYPE" in
  npm)
    PKG="@chio/openclaw"
    echo "=== Verifying $PKG@$VERSION (source: github.com/$SOURCE_REPO) ==="
    failed=0
    if [[ "$CHIO_DRY_RUN" != "true" ]]; then
      chio::require_tools npm slsa-verifier shasum
    fi
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    if [[ -n "$FIXTURE" && -f "$FIXTURE" ]]; then
      echo "Using fixture: $FIXTURE"
      cp "$FIXTURE" "$tmp/"
      tarball="$(basename "$FIXTURE")"
    elif [[ "$CHIO_DRY_RUN" == "true" ]]; then
      echo "[DRY] would: npm pack $PKG@$VERSION"
      tarball="chio-openclaw-${VERSION#v}.tgz"
      : > "$tmp/$tarball"
    else
      tarball="$(chio::download_npm "$PKG" "$VERSION" "$tmp")"
    fi
    chio::verify_npm_provenance "$PKG" "$VERSION" || failed=$((failed+1))
    chio::verify_slsa_npm "$tmp/$tarball" "$PKG" "$SOURCE_REPO" || failed=$((failed+1))
    chio::summary "$PKG@$VERSION" "$failed"
    ;;

  docker)
    IMG="ghcr.io/${CHIO_GH_OWNER:-owner}/chio-openclaw:$VERSION"
    IDENTITY_REGEX="^https://github.com/${SOURCE_REPO}/\\.github/workflows/release\\.yml@refs/tags/v.*$"
    echo "=== Verifying $IMG (source: github.com/$SOURCE_REPO) ==="
    failed=0
    if [[ "$CHIO_DRY_RUN" != "true" ]]; then
      chio::require_tools cosign slsa-verifier
    fi
    chio::verify_cosign_image "$IMG" "$IDENTITY_REGEX" || failed=$((failed+1))
    if [[ "$CHIO_DRY_RUN" == "true" ]]; then
      _yellow "  [DRY] would: slsa-verifier verify-image $IMG"
    else
      if chio::need slsa-verifier; then
        slsa-verifier verify-image "$IMG" \
          --source-uri "github.com/$SOURCE_REPO" \
          && _green "  [OK]  SLSA image provenance verified ($IMG)" \
          || { _red "  [FAIL] SLSA image provenance ($IMG)"; failed=$((failed+1)); }
      else
        failed=$((failed+1))
      fi
    fi
    chio::summary "$IMG" "$failed"
    ;;

  *)
    echo "ERROR: unknown --type '$TYPE' (expected 'npm' or 'docker')" >&2
    exit 1
    ;;
esac
