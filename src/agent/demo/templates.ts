import { TaskSubtype } from "../../domain/classification";

export interface TaskSkeleton {
  title: string;
  objective: string;
  actions: string[];
  deliverables: string[];
  completionCriteria: string[];
  checkpoints: string[];
  dueAt: string;
  feedbackFrequency: string;
}

const qualityDefault: TaskSkeleton[] = [
  {
    title: "问题事实确认",
    objective: "澄清质量问题的事实基础，形成可追溯的问题描述。",
    actions: [
      "收集生产记录、检验记录、不良照片和相关批次信息",
      "确认问题现象、发生时间、影响产品和初步影响范围",
      "整理已知事实与仍需补充的信息",
    ],
    deliverables: ["问题事实确认记录", "证据材料清单"],
    completionCriteria: [
      "问题现象、批次/型号、发现环节和影响范围已明确",
      "关键证据材料已归档或标注缺口",
    ],
    checkpoints: ["事实信息收集完成", "问题描述评审完成"],
    dueAt: "T+1 工作日",
    feedbackFrequency: "每日反馈",
  },
  {
    title: "临时遏制与影响控制",
    objective: "在根因明确前降低问题扩散风险，并控制受影响范围。",
    actions: [
      "识别在制品、库存品、已出货产品和相关工序风险",
      "制定隔离、复检、停线或放行控制建议",
      "同步生产、质量和相关责任方执行临时措施",
    ],
    deliverables: ["临时遏制措施清单", "影响范围与处置记录"],
    completionCriteria: [
      "受影响对象已识别并有明确控制措施",
      "临时措施的责任人和执行状态已记录",
    ],
    checkpoints: ["影响范围确认", "临时措施执行确认"],
    dueAt: "T+1 工作日",
    feedbackFrequency: "每日反馈",
  },
  {
    title: "根因分析计划",
    objective: "建立结构化根因分析路径，避免直接跳到未经验证的结论。",
    actions: [
      "列出可能原因并按人机料法环测维度展开",
      "定义每个假设的验证方法、数据来源和责任人",
      "安排根因分析评审节奏和决策点",
    ],
    deliverables: ["根因分析计划", "原因假设与验证矩阵"],
    completionCriteria: [
      "主要原因假设均有对应验证方法",
      "根因分析计划已明确责任人、输入材料和时间节点",
    ],
    checkpoints: ["原因假设清单完成", "验证计划评审完成"],
    dueAt: "T+3 工作日",
    feedbackFrequency: "每两日反馈",
  },
  {
    title: "纠正措施与验证准备",
    objective: "为后续纠正措施制定和有效性验证准备可执行输入。",
    actions: [
      "基于根因分析输出整理纠正措施建议",
      "定义措施有效性验证方式、样本范围和判定准则",
      "识别需要质量授权人员确认的 CAPA 或 QMS 衔接事项",
    ],
    deliverables: ["纠正措施建议", "有效性验证准备清单"],
    completionCriteria: [
      "纠正措施建议与根因假设保持对应关系",
      "验证方式、样本范围和通过准则已形成草案",
    ],
    checkpoints: ["措施建议草案完成", "验证准备清单完成"],
    dueAt: "T+5 工作日",
    feedbackFrequency: "每两日反馈",
  },
];

const rdVerification: TaskSkeleton[] = [
  {
    title: "验证目标与范围确认",
    objective: "明确 V&V 活动要验证的需求、风险和范围边界。",
    actions: [
      "梳理待验证需求、设计输入和风险控制项",
      "确认验证对象、版本、环境和不在本次覆盖的边界",
      "输出验证目标与范围说明",
    ],
    deliverables: ["验证目标与范围说明", "需求/风险追溯清单"],
    completionCriteria: [
      "验证目标与覆盖范围已明确",
      "待关联的需求、风险或设计输入已列出",
    ],
    checkpoints: ["验证对象确认", "范围边界评审"],
    dueAt: "T+2 工作日",
    feedbackFrequency: "每两日反馈",
  },
  {
    title: "验证方法与样本设计",
    objective: "设计可执行、可复核的验证方法、样本量和通过准则。",
    actions: [
      "定义测试方法、测试条件、样本量和数据记录方式",
      "明确通过准则、失败处理方式和偏差记录要求",
      "确认所需设备、工装、样品和人员准备情况",
    ],
    deliverables: ["验证方法设计", "样本量与通过准则说明"],
    completionCriteria: [
      "测试方法、样本量和通过准则已形成草案",
      "关键资源和前置条件已明确",
    ],
    checkpoints: ["测试方法草案完成", "样本设计确认"],
    dueAt: "T+4 工作日",
    feedbackFrequency: "每两日反馈",
  },
  {
    title: "验证计划评审准备",
    objective: "形成可进入评审的验证计划包，支持研发和质量共同确认。",
    actions: [
      "汇总验证目标、范围、方法、样本和准则",
      "检查计划与需求、风险和设计输入的追溯关系",
      "整理评审议题、开放问题和需决策事项",
    ],
    deliverables: ["验证计划评审包", "开放问题与决策事项清单"],
    completionCriteria: [
      "验证计划内容完整且可评审",
      "开放问题、风险和待决策事项已列明",
    ],
    checkpoints: ["评审包完成", "评审议题确认"],
    dueAt: "T+5 工作日",
    feedbackFrequency: "每两日反馈",
  },
];

const rdDefault: TaskSkeleton[] = [
  {
    title: "研发任务目标确认",
    objective: "明确研发任务的对象、目标、边界和待决策事项。",
    actions: [
      "梳理任务背景、涉及对象、当前版本和关键约束",
      "确认本次需要解决的问题、输出物和不覆盖范围",
      "整理仍需发起人或相关评审方确认的信息",
    ],
    deliverables: ["研发任务目标说明", "开放问题清单"],
    completionCriteria: [
      "研发任务目标、对象和边界已明确",
      "关键开放问题已列出并分配确认责任",
    ],
    checkpoints: ["任务目标确认", "范围边界评审"],
    dueAt: "T+2 工作日",
    feedbackFrequency: "每两日反馈",
  },
  {
    title: "研发执行方案草案",
    objective: "形成可评审的研发执行路径和交付安排。",
    actions: [
      "拆分主要工作项、依赖关系和所需输入材料",
      "定义每项工作的交付物、完成标准和时间节点",
      "识别需要跨部门协作或评审决策的事项",
    ],
    deliverables: ["研发执行方案草案", "任务依赖与协作清单"],
    completionCriteria: [
      "主要工作项、依赖关系和责任协作关系已形成草案",
      "交付物、完成标准和反馈节奏已明确",
    ],
    checkpoints: ["执行路径草案完成", "协作事项确认"],
    dueAt: "T+4 工作日",
    feedbackFrequency: "每两日反馈",
  },
  {
    title: "研发评审准备",
    objective: "准备进入研发评审或发起人确认的材料包。",
    actions: [
      "汇总目标、方案、风险、开放问题和待确认事项",
      "检查输出物是否具备评审输入所需的完整性",
      "安排评审节奏并明确会后行动项记录方式",
    ],
    deliverables: ["研发评审材料包", "待决策事项清单"],
    completionCriteria: [
      "评审材料内容完整且可追溯",
      "待决策事项、风险和后续行动记录方式已明确",
    ],
    checkpoints: ["评审材料包完成", "评审安排确认"],
    dueAt: "T+5 工作日",
    feedbackFrequency: "每两日反馈",
  },
];

export function getTaskSkeletons(subtype: TaskSubtype): TaskSkeleton[] {
  if (subtype === "VERIFICATION_AND_VALIDATION") return rdVerification;
  if (
    subtype === "REQUIREMENT_OR_DESIGN_INPUT" ||
    subtype === "SOLUTION_DEVELOPMENT" ||
    subtype === "DESIGN_CHANGE_ACTION" ||
    subtype === "RD_OTHER_OR_UNCERTAIN"
  ) {
    return rdDefault;
  }

  return qualityDefault;
}
