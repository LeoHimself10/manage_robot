import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyAssignmentEntry } from "../security/web-entry-token";

export function handleAssignmentHttp(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );

  if (url.pathname === "/assignment/workbench" && req.method === "GET") {
    const tokenParam = url.searchParams.get("token");
    if (!tokenParam) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Missing token parameter");
      return true;
    }

    let verified: ReturnType<typeof verifyAssignmentEntry>;
    try {
      verified = verifyAssignmentEntry(tokenParam);
    } catch (err) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        `Access denied: ${err instanceof Error ? err.message : "invalid token"}`,
      );
      return true;
    }

    // In v1, just show a simple HTML page
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><title>分配工作台</title></head>
<body>
<h1>分配工作台</h1>
<p>规划：<code>${verified.planId}</code></p>
<p>用户：<code>${verified.userId}</code>（角色：${verified.role}）</p>
<p>本页面为 v0.2 骨架，后续版本将展示完整 AssignmentDraft 表格与覆盖编辑功能。</p>
</body>
</html>`);
    return true;
  }

  return false; // not handled here
}
