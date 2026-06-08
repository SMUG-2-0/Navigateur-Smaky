#!/usr/bin/env bash
#
# Installe (ou supprime) un lanceur d'application GNOME/freedesktop pour le
# « Navigateur Smaky » : entrée dans le menu des applications + icône.
#
# Usage :
#   ./install-desktop-linux.sh [chemin/vers/AppImage]   installe le lanceur
#   ./install-desktop-linux.sh --uninstall              supprime le lanceur
#
# Sans argument, le script cherche automatiquement une AppImage dans ./dist/.
# Fonctionne au niveau utilisateur (pas de sudo) : tout est écrit sous
# ~/.local/share. Compatible GNOME, KDE et tout bureau respectant freedesktop.
#
set -euo pipefail

APP_NAME="Navigateur Smaky"
DESKTOP_ID="smaky-viewer"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APPS_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
DESKTOP_FILE="$APPS_DIR/$DESKTOP_ID.desktop"
ICON_DEST="$ICON_DIR/$DESKTOP_ID.png"

refresh() {
  update-desktop-database "$APPS_DIR" 2>/dev/null || true
  gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
}

# --- Désinstallation ---------------------------------------------------------
if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$DESKTOP_FILE" "$ICON_DEST"
  refresh
  echo "Lanceur « $APP_NAME » supprimé."
  exit 0
fi

# --- Localiser l'AppImage ----------------------------------------------------
APPIMAGE="${1:-}"
if [[ -z "$APPIMAGE" ]]; then
  APPIMAGE="$(ls -1 "$SCRIPT_DIR"/dist/*.AppImage 2>/dev/null | sort -V | tail -n1 || true)"
fi
if [[ -z "$APPIMAGE" || ! -f "$APPIMAGE" ]]; then
  echo "Erreur : AppImage introuvable." >&2
  echo "  Construis-la d'abord (npm run dist:linux) ou indique son chemin :" >&2
  echo "  $0 \"/chemin/vers/Navigateur Smaky-x.y.z.AppImage\"" >&2
  exit 1
fi
APPIMAGE="$(readlink -f "$APPIMAGE")"
chmod +x "$APPIMAGE"

# --- Installer l'icône -------------------------------------------------------
mkdir -p "$ICON_DIR"
ICON_SRC="$SCRIPT_DIR/build/icon.png"
if [[ -f "$ICON_SRC" ]]; then
  cp "$ICON_SRC" "$ICON_DEST"
  ICON_REF="$DESKTOP_ID"
else
  echo "Avertissement : build/icon.png absent, icône générique utilisée." >&2
  ICON_REF="application-x-executable"
fi

# --- Créer le fichier .desktop ----------------------------------------------
mkdir -p "$APPS_DIR"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME
GenericName=Navigateur Smaky
Comment=Navigateur et visualiseur de disques Smaky (format FOS)
Exec="$APPIMAGE" %U
Icon=$ICON_REF
Terminal=false
Categories=Utility;Archiving;
Keywords=Smaky;FOS;Epsitec;disque;archive;
StartupWMClass=Navigateur Smaky
EOF
chmod +x "$DESKTOP_FILE"

refresh

echo "Lanceur installé."
echo "  AppImage : $APPIMAGE"
echo "  .desktop : $DESKTOP_FILE"
echo "  Icône    : $ICON_DEST"
echo
echo "Cherche « $APP_NAME » dans le menu des applications."
echo "(Si l'icône n'apparaît pas tout de suite, ferme/rouvre la session.)"
