import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import {
  fixMultipartFilenameEncoding,
  readMultipartSingleFile,
} from "../../src/web/multipart-single-file";

function multipartReq(body: Buffer, boundary: string): IncomingMessage {
  const r = Readable.from(body) as IncomingMessage;
  r.headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
  };
  return r;
}

describe("readMultipartSingleFile", () => {
  it("preserves UTF-8 characters in Content-Disposition filename", async () => {
    const boundary = "----WebKitTestBoundary";
    const name = "样例-花名册-测试.md";
    const body = Buffer.from(
      [
        `--${boundary}`,
        `Content-Disposition: form-data; name="roster"; filename="${name}"`,
        "Content-Type: text/plain",
        "",
        "ok",
        `--${boundary}--`,
        "",
      ].join("\r\n"),
      "utf8",
    );
    const result = await readMultipartSingleFile(multipartReq(body, boundary));
    expect(result.file?.filename).toBe(name);
    expect(result.file?.buffer.toString("utf8")).toBe("ok");
  });
});

describe("fixMultipartFilenameEncoding", () => {
  it("repairs UTF-8 filename bytes mis-decoded as latin1", () => {
    const garbled = Buffer.from("测试.md", "utf8").toString("latin1");
    expect(fixMultipartFilenameEncoding(garbled)).toBe("测试.md");
  });
});
