# Bundled subtitle fonts

Noto Sans SC and Noto Serif SC variable TrueType fonts are provided for Chinese and Latin subtitle text. Original, unmodified files are sourced from the Google Fonts repository; `manifest.json` records source URLs, SHA-256 hashes and sizes. Each font’s SIL Open Font License is preserved beside it.

The browser and Pillow use the same bundled files. Font weights 300, 400, 500, 600 and 700 use the variable weight axis. Fonts are served locally only when selected; rendering never downloads fonts. The legacy `system` setting retains operating-system fonts and `MEDIA_FONT` for existing projects.

The public source export, installer and private runtime package must include this entire directory. Do not substitute a missing bundled font silently; reinstall a complete runtime instead.
