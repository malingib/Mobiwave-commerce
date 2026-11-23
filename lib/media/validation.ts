import { createHash } from "node:crypto";
export type SupportedMedia = { mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | "video/mp4" | "audio/ogg" | "audio/mpeg" | "audio/mp4"; maxBytes: number; extension: "jpg" | "png" | "webp" | "pdf" | "mp4" | "ogg" | "mp3" | "m4a" };
const IMAGE_LIMIT = 10 * 1024 * 1024;
const PDF_LIMIT = 20 * 1024 * 1024;
const VIDEO_LIMIT = 25 * 1024 * 1024;
const AUDIO_LIMIT = 25 * 1024 * 1024;
function startsWith(bytes: Uint8Array, signature: number[]) { return signature.every((value, index) => bytes[index] === value); }
export function mediaPolicyForMimeType(mimeType: string): SupportedMedia | null {
  const policies: Record<string, SupportedMedia> = {
    "image/jpeg": { mimeType: "image/jpeg", maxBytes: IMAGE_LIMIT, extension: "jpg" },
    "image/png": { mimeType: "image/png", maxBytes: IMAGE_LIMIT, extension: "png" },
    "image/webp": { mimeType: "image/webp", maxBytes: IMAGE_LIMIT, extension: "webp" },
    "application/pdf": { mimeType: "application/pdf", maxBytes: PDF_LIMIT, extension: "pdf" },
    "video/mp4": { mimeType: "video/mp4", maxBytes: VIDEO_LIMIT, extension: "mp4" },
    "audio/ogg": { mimeType: "audio/ogg", maxBytes: AUDIO_LIMIT, extension: "ogg" },
    "audio/mpeg": { mimeType: "audio/mpeg", maxBytes: AUDIO_LIMIT, extension: "mp3" },
    "audio/mp4": { mimeType: "audio/mp4", maxBytes: AUDIO_LIMIT, extension: "m4a" },
  };
  return policies[mimeType] || null;
}
export function sanitizeMediaFileName(fileName: string) {
  return fileName.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/[^\p{L}\p{N}._ -]/gu, "_").trim().slice(0, 120) || "attachment";
}
export function detectSupportedMedia(bytes: Uint8Array, expectedMimeType?: string): SupportedMedia | null {
  if (startsWith(bytes, [0xff,0xd8,0xff])) return { mimeType:"image/jpeg",maxBytes:IMAGE_LIMIT,extension:"jpg" };
  if (startsWith(bytes, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) return { mimeType:"image/png",maxBytes:IMAGE_LIMIT,extension:"png" };
  if (bytes.length>=12 && String.fromCharCode(...bytes.subarray(0,4))==="RIFF" && String.fromCharCode(...bytes.subarray(8,12))==="WEBP") return { mimeType:"image/webp",maxBytes:IMAGE_LIMIT,extension:"webp" };
  if (startsWith(bytes,[0x25,0x50,0x44,0x46,0x2d])) return { mimeType:"application/pdf",maxBytes:PDF_LIMIT,extension:"pdf" };
  if (bytes.length>=12 && String.fromCharCode(...bytes.subarray(4,8))==="ftyp") {
    if (expectedMimeType === "audio/mp4") return { mimeType:"audio/mp4",maxBytes:AUDIO_LIMIT,extension:"m4a" };
    return { mimeType:"video/mp4",maxBytes:VIDEO_LIMIT,extension:"mp4" };
  }
  if (startsWith(bytes, [0x4f,0x67,0x67,0x53])) return { mimeType:"audio/ogg",maxBytes:AUDIO_LIMIT,extension:"ogg" };
  if (startsWith(bytes, [0x49,0x44,0x33]) || (bytes.length > 1 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { mimeType:"audio/mpeg",maxBytes:AUDIO_LIMIT,extension:"mp3" };
  }
  return null;
}
export function validateMediaUpload(input:{bytes:Uint8Array;declaredMimeType:string;fileName:string}) {
  const {bytes,declaredMimeType,fileName}=input;
  if (!bytes.length) return {ok:false as const,error:"The uploaded file is empty."};
  const media=detectSupportedMedia(bytes);
  if (!media) return {ok:false as const,error:"Unsupported file type. Upload JPEG, PNG, WebP, PDF, MP4, OGG, MP3 or M4A."};
  if (bytes.byteLength>media.maxBytes) return {ok:false as const,error:"The file exceeds the maximum size for this file type."};
  const declared=declaredMimeType.trim().toLowerCase();
  if (declared && declared!=="application/octet-stream" && declared!==media.mimeType) return {ok:false as const,error:"The file content does not match its declared MIME type."};
  const safeName=sanitizeMediaFileName(fileName);
  return {ok:true as const,media,fileName:safeName,byteSize:bytes.byteLength,sha256:createHash("sha256").update(bytes).digest("hex")};
}
