import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { detectSupportedMedia,mediaPolicyForMimeType,sanitizeMediaFileName,validateMediaUpload } from "./validation";
describe("private media validation",()=>{
  it("detects JPEG, PNG, WebP, PDF and MP4 signatures",()=>{
    assert.equal(detectSupportedMedia(Buffer.from([0xff,0xd8,0xff,0]))?.mimeType,"image/jpeg");
    assert.equal(detectSupportedMedia(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))?.mimeType,"image/png");
    assert.equal(detectSupportedMedia(Buffer.from("RIFF0000WEBP"))?.mimeType,"image/webp");
    assert.equal(detectSupportedMedia(Buffer.from("%PDF-1.7"))?.mimeType,"application/pdf");
    assert.equal(detectSupportedMedia(Buffer.from("0000ftypisom"))?.mimeType,"video/mp4");
  });
  it("detects supported WhatsApp voice-note and audio formats",()=>{
    assert.equal(detectSupportedMedia(Buffer.from("OggS0000"))?.mimeType,"audio/ogg");
    assert.equal(detectSupportedMedia(Buffer.from("ID3\x04\x00\x00"))?.mimeType,"audio/mpeg");
    assert.equal(detectSupportedMedia(Buffer.from("0000ftypisom"),"audio/mp4")?.mimeType,"audio/mp4");
    assert.equal(mediaPolicyForMimeType("audio/ogg")?.extension,"ogg");
  });
  it("rejects empty, unsupported and MIME-spoofed files",()=>{
    assert.equal(validateMediaUpload({bytes:Buffer.alloc(0),declaredMimeType:"image/png",fileName:"a.png"}).ok,false);
    assert.equal(validateMediaUpload({bytes:Buffer.from("<svg/>"),declaredMimeType:"image/svg+xml",fileName:"a.svg"}).ok,false);
    assert.equal(validateMediaUpload({bytes:Buffer.from([0xff,0xd8,0xff]),declaredMimeType:"image/png",fileName:"a.png"}).ok,false);
  });
  it("sanitizes filenames and computes a stable checksum",()=>{
    const result=validateMediaUpload({bytes:Buffer.from([0xff,0xd8,0xff,0]),declaredMimeType:"image/jpeg",fileName:"../private\\photo.jpg"});
    assert.equal(result.ok,true);
    if(result.ok){assert.equal(result.fileName.includes("/"),false);assert.match(result.sha256,/^[a-f0-9]{64}$/);assert.equal(result.media.extension,"jpg")}
  });
  it("exposes only the supported MIME policy and sanitizes upload names",()=>{
    assert.equal(mediaPolicyForMimeType("image/svg+xml"),null);
    assert.equal(mediaPolicyForMimeType("image/jpeg")?.maxBytes,10*1024*1024);
    assert.equal(sanitizeMediaFileName("../x\\y.jpg").includes("/"),false);
  });
  it("enforces media-specific byte limits",()=>{
    const bytes=Buffer.alloc(10*1024*1024+1);bytes.set([0xff,0xd8,0xff]);
    assert.equal(validateMediaUpload({bytes,declaredMimeType:"image/jpeg",fileName:"large.jpg"}).ok,false);
  });
});
