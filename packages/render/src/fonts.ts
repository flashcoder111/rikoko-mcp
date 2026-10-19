import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captionFonts } from "../../contracts/src/caption-style.js";

/** Only bundled, openly licensed font filenames can be requested. */
export async function captionFontBytes(filename: string) {
  if (!captionFonts.some((font) => "file" in font && font.file === filename))
    return;
  const root =
    process.env.WORKBENCH_ROOT ??
    fileURLToPath(new URL("../../../", import.meta.url));
  return readFile(resolve(root, "packages/render/fonts", filename));
}
