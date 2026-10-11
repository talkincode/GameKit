import { SPRITE_ANIM_FORMAT, parseSpriteAnim, type SpriteAnimation } from "../pixel/anim";

/**
 * The animation note that sits next to a copied sprite sheet.
 * The image path is the copy inside the project, never a library URL.
 * Null when the note would not open in the animation editor.
 */
export function librarySpriteNote(imagePath: string, animation: SpriteAnimation): string | null {
  const text = `${JSON.stringify(
    {
      format: SPRITE_ANIM_FORMAT,
      formatVersion: 1,
      image: imagePath,
      animation,
    },
    null,
    2,
  )}\n`;
  return parseSpriteAnim(text, imagePath).ok ? text : null;
}
