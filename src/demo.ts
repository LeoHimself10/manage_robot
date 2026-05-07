import { createTaskPlanningDemo } from "./agent/demo/pipeline";

const result = createTaskPlanningDemo({
  domainHint: "QUALITY",
  background:
    "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
});

if (result.status === "NEEDS_MORE_INFO") {
  console.log("需要补充以下信息：");
  for (const question of result.questions) console.log(`- ${question}`);
} else {
  console.log(result.markdown);
}
