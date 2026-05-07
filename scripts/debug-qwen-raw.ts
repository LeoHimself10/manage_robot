import "dotenv/config";

async function main(): Promise<void> {
  const apiKey = process.env.QWEN_API_KEY;
  const baseUrl =
    process.env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const model = process.env.QWEN_MODEL ?? "qwen-plus";
  if (!apiKey) throw new Error("missing QWEN_API_KEY");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2000,
      ...(process.env.QWEN_DEBUG_RESPONSE_FORMAT === "1"
        ? { response_format: { type: "json_object" } }
        : {}),
      messages: [
        {
          role: "system",
          content:
            "你是任务规划助手。请输出一个 JSON 对象，包含 classification/tasks/openQuestions/capaAdvisory。",
        },
        {
          role: "user",
          content:
            "domainHint: QUALITY\n请基于以下背景生成结构化任务拆解：\n生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        },
      ],
    }),
  });

  console.log("status", response.status);
  const text = await response.text();
  if (!response.ok) {
    console.log("body", text);
    return;
  }

  const json = JSON.parse(text) as Record<string, unknown>;
  console.log(
    "content",
    JSON.stringify(
      (json.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]
        ?.message?.content ?? "",
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
