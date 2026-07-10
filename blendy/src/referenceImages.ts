const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  webp: "image/webp",
  bmp: "image/jpeg",
  gif: "image/jpeg",
  avif: "image/jpeg",
  heic: "image/jpeg",
  heif: "image/jpeg",
  tif: "image/jpeg",
  tiff: "image/jpeg",
};

export function inferReferenceMimeType(filename: string, declaredType = ""): string {
  const declared = String(declaredType).toLowerCase().split(";", 1)[0].trim();
  if (declared === "image/png" || declared === "image/webp") return declared;
  if (declared === "image/jpeg" || declared === "image/jpg" || declared === "image/pjpeg") return "image/jpeg";
  if (declared.startsWith("image/")) return "image/jpeg";
  const extension = String(filename).toLowerCase().split(".").pop() || "";
  return MIME_BY_EXTENSION[extension] || "";
}
