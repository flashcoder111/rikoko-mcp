export type PromptReferenceSyntax = "descriptive" | "kling";
export function promptReferenceSyntax(model?: {
  endpoint?: string;
  generationInput?: { mode?: string; referenceSyntax?: PromptReferenceSyntax };
}): PromptReferenceSyntax {
  return (
    model?.generationInput?.referenceSyntax ??
    (model?.endpoint?.startsWith("fal-ai/kling-video/o3/")
      ? "kling"
      : "descriptive")
  );
}
export function referenceToken(
  syntax: PromptReferenceSyntax,
  role: string,
  index: number,
) {
  const kind = ["motion", "source_video"].includes(role) ? "Video" : "Image";
  if (syntax === "kling") return `@${kind}${index}`;
  if (role === "first_frame") return "The first frame";
  if (role === "last_frame") return "The last frame";
  return `${kind} ${index}`;
}
