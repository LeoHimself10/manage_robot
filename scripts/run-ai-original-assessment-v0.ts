import "dotenv/config";
import {
  AiOriginalAssessmentV0RunError,
  prepareAiOriginalAssessmentV0,
  runAiOriginalAssessmentV0,
} from "../src/quality/ai-original-assessment/ai-original-assessment-v0-runner";
import { buildAiOriginalAssessmentV0Messages } from
  "../src/quality/ai-original-assessment/ai-original-assessment-v0-prompt";
import {
  loadQwenAiOriginalAssessmentConfigFromEnv,
  QwenAiOriginalAssessmentModel,
} from "../src/quality/ai-original-assessment/qwen-ai-original-assessment-model";

function printSection(title: string, value: unknown): void {
  process.stdout.write(`\n=== ${title} ===\n`);
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const prepared = prepareAiOriginalAssessmentV0();
  printSection("1. 完全脱敏假反馈（标准化后）", prepared.normalizedFeedback);
  printSection("2. 本次分类字典", prepared.input.categoryDictionary);
  printSection("3. 固定提供的3条脱敏假案例", prepared.input.retrievedCases);
  printSection("4. 完整AI输入合同", prepared.input);
  const messages = buildAiOriginalAssessmentV0Messages({ assessmentInput: prepared.input });
  printSection("5. 准备发给AI的完整消息（不含API密钥）", messages);

  const config = loadQwenAiOriginalAssessmentConfigFromEnv();
  if (!config) {
    process.stderr.write(
      "\n安全退出：缺少DASHSCOPE_API_KEY或QWEN_API_KEY。未发起任何模型请求；离线测试仍可正常运行。\n",
    );
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`\n正在调用模型：${config.clientConfig.model}（无工具、正常路径一次请求）\n`);

  const result = await runAiOriginalAssessmentV0({
    model: new QwenAiOriginalAssessmentModel(config),
    prepared,
  });
  printSection("6. AI原始返回", result.modelResponse.rawContent);
  printSection("7. 程序校验结果", {
    ok: result.validation.ok,
    attempts: result.attempts,
    toolCallsExecuted: result.modelResponse.toolCallsExecuted,
    model: result.modelResponse.trace.model,
    modelRequestId: result.modelResponse.trace.requestId,
  });
  printSection("8. 完整AI研判建议（等待人工审核）", result.output);
}

main().catch((error: unknown) => {
  if (error instanceof AiOriginalAssessmentV0RunError) {
    process.stderr.write(`\n运行失败 [${error.code}]：${error.message}\n`);
    if (error.validationIssues.length > 0) {
      process.stderr.write(`${JSON.stringify(error.validationIssues, null, 2)}\n`);
    }
  } else {
    process.stderr.write(`\n运行失败：${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
});
