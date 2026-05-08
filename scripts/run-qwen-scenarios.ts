import "dotenv/config";

import { createTaskPlanningDemo } from "../src/agent/demo/pipeline";
import { loadQwenPlannerConfigFromEnv, runQwenPlanner } from "../src/agent/demo/qwen-planner";

interface Scenario {
  id: string;
  domainHint: "QUALITY" | "RD";
  background: string;
}

const scenarios: Scenario[] = [
  {
    id: "S1-质量-产线异常",
    domainHint: "QUALITY",
    background:
      "产线测试发现 A 产品 2026-05-03 批次开机自检失败率升高至 18%，影响 35 台，已有测试日志和不良照片，要求 48 小时内给出初步分析与遏制建议。",
  },
  {
    id: "S2-质量-客诉现场",
    domainHint: "QUALITY",
    background:
      "客户反馈已交付设备现场运行 2 周后频繁重启，涉及 3 家医院共 12 台设备，已有现场视频和日志，需要评估影响范围及是否建议 CAPA。",
  },
  {
    id: "S3-研发-VV规划",
    domainHint: "RD",
    background:
      "研发任务：制定 B 设备 V&V 验证方案，覆盖需求追溯、样本量、测试方法、通过准则与风险项，计划本周五完成评审包。",
  },
  {
    id: "S4-研发-设计变更",
    domainHint: "RD",
    background:
      "研发任务：针对 ECN 变更后主板电源模块，完成影响评估、回归验证与文档更新，需明确依赖关系和跨团队协作输入。",
  },
  /** 故意信息过少：期望模型 LOW + 追问，pipeline 返回 NEEDS_MORE_INFO */
  {
    id: "S5-质量-信息不足",
    domainHint: "QUALITY",
    background: "质量那边说有问题，先把任务拆了。",
  },
  /** 研发域同样过短：期望模型 LOW + 追问 */
  {
    id: "S6-研发-信息不足",
    domainHint: "RD",
    background: "研发这边有个事要推进一下。",
  },
  /** 复杂现实场景：供应商来料 + 产线断料风险 + 多批次追溯 */
  {
    id: "S7-质量-IQC供应商批量不良",
    domainHint: "QUALITY",
    background:
      "IQC 于 2026-05-06 对供应商 S-TEC 供料「陶瓷电容 CL32 10uF」执行加严抽检，Lot SN26-04-108~112 五卷中共检出 22 只虚焊相关外观不良（裂纹/电极偏移），" +
      "该料号本周已上线 SMT-A 线用于 X200 主板；PE 已临时通知仓库冻结同 Lot 未投料 3400 pcs，但 SMT 线边仓已上料约 1200 pcs，存在混批风险。" +
      "要求：72 小时内完成不良机种隔离筛查、已装机板卡的追溯范围界定、临时加检方案（AOI+ICT 比例）及对客户的初步风险通报口径说明；质量部牵头，采购、计划、工艺、客服参加。",
  },
  /** 复杂现实场景：OOB + 多机构 + 监管/审计应对要素 */
  {
    id: "S8-质量-OOB医院客诉与报告",
    domainHint: "QUALITY",
    background:
      "上市后监督：华东地区 3 家三级医院共报告 9 台监护仪（型号 M-900，软件 V2.8.1，硬件 RevD）在 2026-04-20～05-01 期间出现「夜间偶发波形冻结」；" +
      "其中 2 起关联输血科高风险使用场景。已有 6 台拉回公司分析，示波器抓取显示 DDR 自检偶发超时；" +
      "R&D 初步怀疑与某批 EEPROM 读写裕量相关，但未最终确认。" +
      "法规事务要求 10 个工作日内提交初步危害评估与是否启动 FSN 的建议；需明确现场剩余在役设备数量、临时软件规避方案可行性、以及是否触发 CAPA 及与 ISO13485 记录衔接。",
  },
  /** 复杂现实场景：跨软件/硬件/注册的多包发版 */
  {
    id: "S9-研发-闭环发版与依赖",
    domainHint: "RD",
    background:
      "产品「糖代谢分析仪」计划 2026-05-20 发布软件组合：主机固件 v3.5.0（STM32H7）、算法 DLL 2.3.0（Windows 服务）、Android 采集 APK 1.9.2。" +
      "本次包含：蓝牙 BLE 配对超时修复、与 LIS HL7 接口字段对齐、CE 技术文档引用的性能指标更新。" +
      "依赖方：硬件需同步 ECO-24018 丝印；临床运营已预约 5/18 试点医院 20 台；注册经理提醒若触及「适用标准」条款变更需走变更评估。" +
      "请拆解为可承接的 WBS：需求冻结、联调窗口、验证层级（单元/系统/现场）、回滚与灰度策略、文档与标签更新责任人。",
  },
  /** 复杂现实场景：现场紧急缺陷 + hotfix + 回归矩阵 */
  {
    id: "S10-研发-现场Hotfix与回归",
    domainHint: "RD",
    background:
      "现场紧急：物流扫码枪 PDA（Android 11）在 v4.2.3 上于冷库环境（-5℃）连续扫码 200 次后出现相机驱动崩溃，导致入库停止；" +
      "客户为医药物流 TOP3，合同 SLA 要求 24h 内给出临时方案。" +
      "研发现状：BSP 同事已复现并指向 Camera HAL 缓冲泄漏；需在 48h 内出 hotfix branch、完成低温/高湿回归矩阵（至少 3 款 PDA SKU），" +
      "并与售后确认远程推送策略（WiFi/MDM）。任务需写明验证证据形态（logcat、温度舱记录）、合入主线与补丁分支策略。",
  },
  /** 复杂现实场景：设计变更引发的质量调查（跨设计-质量边界） */
  {
    id: "S11-质量-ECO后良率下滑",
    domainHint: "QUALITY",
    background:
      "ECO-24102 将主板电源轨从 3.3V LDO 改为 DCDC 后，FQC 终检在 2026-05-04～05-05 两日中记录 X200 主板开机一次通过率由 99.2% 降至 96.7%，" +
      "主要不良集中在「上电时序过长导致自检窗口误判」；RD 已在实验板印证与新的缓启动电路相关。" +
      "生产要求 5/10 前决定：是否暂停该 ECO 批量投产、是否需要补充 ICT 测试项或放宽节拍；" +
      "质量需牵头组织原因验证与临时筛选方案（ICT/老化），并评估对已出货约 800 台主板的风险分级与客户沟通策略。",
  },
];

async function main(): Promise<void> {
  const config = loadQwenPlannerConfigFromEnv();
  if (!config) {
    throw new Error("missing Qwen config from env");
  }

  const tallies = {
    DRAFT_READY: 0,
    NEEDS_MORE_INFO: 0,
    GENERATION_FAILED: 0,
  };

  for (const scenario of scenarios) {
    const result = await createTaskPlanningDemo(
      {
        domainHint: scenario.domainHint,
        background: scenario.background,
      },
      {
        llmPlanner: (request) => runQwenPlanner(request, config),
      }
    );

    if (result.status === "NEEDS_MORE_INFO") {
      tallies.NEEDS_MORE_INFO++;
      console.log(
        JSON.stringify(
          {
            id: scenario.id,
            status: result.status,
            missingFields: result.missingFields,
            questions: result.questions,
          },
          null,
          2
        )
      );
      continue;
    }

    if (result.status === "GENERATION_FAILED") {
      tallies.GENERATION_FAILED++;
      console.log(
        JSON.stringify(
          {
            id: scenario.id,
            status: result.status,
            reason: result.reason,
            recoverySuggestions: result.recoverySuggestions,
          },
          null,
          2
        )
      );
      continue;
    }

    tallies.DRAFT_READY++;
    console.log(
      JSON.stringify(
        {
          id: scenario.id,
          status: result.status,
          domain: result.classification.domain,
          subtype: result.classification.subtype,
          confidence: result.classification.confidence,
          traceRequestId: result.generation.trace?.requestId ?? null,
          gatePassed: result.gate.passed,
          taskCount: result.tasks.length,
          firstTaskTitles: result.tasks.slice(0, 3).map((task) => task.title),
          openQuestionCount: result.questions.length,
          capaAdvisory: result.capaAdvisory?.advisory ?? null,
          tokens: result.generation.trace?.tokenUsage.totalTokens ?? 0,
          latencyMs: result.generation.trace?.latencyMs ?? 0,
        },
        null,
        2
      )
    );
  }

  console.log(
    JSON.stringify(
      { summary: "cloud-agent-scenarios-done", tallies, total: scenarios.length },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
