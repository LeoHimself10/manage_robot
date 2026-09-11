import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Reuse the running original system's adapters, prompts, taxonomy, retrieval and
// validators. No copied prompt, canned fallback, tool call or business mutation.
export async function loadOriginalAiRuntime(originalRoot, env = process.env) {
  originalRoot = resolve(originalRoot);
  const require = createRequire(join(originalRoot, 'package.json'));
  const { parse } = require('dotenv');
  const { z } = require('zod');
  const envPath = join(originalRoot, '.env');
  const configured = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
  const modelEnv = {};
  for (const key of new Set([...Object.keys(configured), ...Object.keys(env)])) {
    if (/^(QWEN_|DASHSCOPE_API_KEY$|QUALITY_ANALYSIS_QWEN_)/.test(key)) {
      modelEnv[key] = env[key] ?? configured[key];
    }
  }
  const sourceModule = (file) => import(pathToFileURL(join(originalRoot, 'src/quality', file)).href);
  const [maModel, maRunner, retrieval, source, context, tongModel, contracts, validator] = await Promise.all([
    sourceModule('ai-original-assessment/qwen-ai-original-assessment-model.ts'),
    sourceModule('ai-original-assessment/ai-original-assessment-v0-runner.ts'),
    sourceModule('ai-original-assessment/historical-feedback-case-retriever.ts'),
    sourceModule('source/quality-source-schema.ts'),
    sourceModule('ai-original-assessment/ai-original-assessment-v0-context.ts'),
    sourceModule('analysis/qwen-quality-analysis-model.ts'),
    sourceModule('analysis/quality-analysis-contracts.ts'),
    sourceModule('analysis/validate-quality-analysis.ts'),
  ]);
  const maConfig = maModel.loadQwenAiOriginalAssessmentConfigFromEnv(modelEnv);
  const tongConfig = tongModel.loadQwenQualityAnalysisConfig(modelEnv);
  const caseRetriever = retrieval.createDefaultHistoricalFeedbackCaseRetriever();
  const text = (max = 2000) => z.string().trim().max(max).default('');
  const feedbackSchema = z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), version: z.number().int().positive(),
    no: text(100), title: z.string().trim().min(1).max(200), what: text(5000), how: text(4000),
    date: text(100), occurred: text(100), person: text(200), model: text(200), serial: text(200),
    batch: text(200), software: text(200), impact: text(2000),
  }).strict();
  const schema = z.object({
    requestId: z.string().uuid(), source: feedbackSchema,
    event: z.object({ no: text(100), category: text(500), risk: text(100),
      managerConclusion: text(5000), managerTime: text(100), upstreamAi: z.record(z.string(), z.unknown()),
    }).strict().optional(),
    attachments: z.array(z.object({name: text(255), type: text(200), description: text(2000)}).strict()).max(100).default([]),
  }).strict();
  function normalize(s, dataScope = 'UI_SAMPLE') {
    const realOa = dataScope === 'DINGTALK_OA';
    return source.normalizeQualitySourceSheet({sheetId: realOa ? 'dingtalk-oa-feedback' : 'connected-ui-sample', sheetName: realOa ? '用服反馈流程' : '界面样例来源', rows: [
      ['反馈时间', '反馈单号', '反馈人', '设备型号', '设备序列号', '导管批次', '问题描述', '对术者造成的影响'],
      [s.date, (realOa ? 'dingtalk-oa:' : 'ui-sample:') + s.id + ':' + s.no, s.person, s.model, s.serial, s.batch,
        [s.title, s.what, s.how, s.software && '软件版本：' + s.software].filter(Boolean).join('\n'), s.impact],
    ]})[0];
  }
  const departments = [{departmentId: 'rd', departmentName: '研发中心'}, {departmentId: 'production', departmentName: '生产中心'}];
  const health = {
    connected: !!maConfig && !!tongConfig, dataScope: 'UI_SAMPLE',
    assessment: {configured: !!maConfig, model: maConfig?.clientConfig.model,
      promptVersion: context.AI_ORIGINAL_ASSESSMENT_V0_PROMPT_VERSION,
      rules: context.V0_CATEGORY_DICTIONARY.version, cases: caseRetriever.version},
    analysis: {configured: !!tongConfig, model: tongConfig?.clientConfig.model,
      promptVersion: contracts.QUALITY_ANALYSIS_PROMPT_VERSION,
      rules: contracts.QUALITY_ANALYSIS_RULE_VERSION, knowledge: contracts.QUALITY_ANALYSIS_KNOWLEDGE_VERSION},
  };
  return {
    modelEnv,
    health,
    validate(kind, body) {
      const parsed = schema.parse(body);
      if (kind === 'initial-analysis' && !parsed.event) throw Object.assign(new Error('缺少已确认的通报背景'), {code: 'INVALID_INPUT'});
      return parsed;
    },
    async run(kind, body, dataScope = 'UI_SAMPLE') {
      const config = kind === 'assessment' ? maConfig : tongConfig;
      if (!config) throw Object.assign(new Error('原系统未配置 Qwen 密钥'), {code: 'MODEL_NOT_CONFIGURED'});
      const normalizedFeedback = normalize(body.source, dataScope);
      const prepared = maRunner.prepareAiOriginalAssessmentV0WithHistoricalRetrieval({
        normalizedFeedback, requestId: body.requestId, sourceVersion: body.source.version, caseRetriever,
      });
      if (kind === 'assessment') {
        const result = await maRunner.runAiOriginalAssessmentV0({model: new maModel.QwenAiOriginalAssessmentModel(config), prepared});
        const category = context.V0_CATEGORY_DICTIONARY.categories.find(x => x.primaryCode === result.output.primaryCategoryCode);
        return {input: prepared.input, output: result.output, retrievedCases: prepared.input.retrievedCases,
          category: {primary: category.primaryLabel, secondary: category.secondaryCategories.find(x => x.secondaryCode === result.output.secondaryCategoryCode).secondaryLabel},
          model: result.modelResponse.trace.model, usage: result.modelResponse.trace.tokenUsage,
          promptVersion: health.assessment.promptVersion};
      }
      const e = body.event;
      const input = contracts.qualityAnalysisInputSchema.parse({
        schemaVersion: contracts.QUALITY_ANALYSIS_INPUT_SCHEMA_VERSION,
        inputVersion: `ui-sample:${body.source.id}:v${body.source.version}:${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}`,
        event: {qualityEventId: 'ui-sample:' + body.source.id, eventNo: e.no || body.source.no,
          title: body.source.title, problemStatus: normalizedFeedback.issueDescription,
          occurredAt: body.source.occurred || null, impact: body.source.impact || null, riskLevel: e.risk || null,
          confirmedCategory: e.category || null, eventVersion: body.source.version},
        frozenReportingContext: {
          sourceSnapshots: [{...prepared.input.sourceSnapshot, dataScope: 'UI_SAMPLE'}],
          aiOriginalAssessments: [e.upstreamAi],
          managerAssessments: [{conclusion: e.managerConclusion, categoryDisplayName: e.category, confirmedAt: e.managerTime, dataScope: 'UI_SAMPLE'}],
          frozenAt: e.managerTime || null,
        },
        similarHistoricalCases: prepared.input.retrievedCases,
        attachments: body.attachments.map(a => ({fileName: a.name, mimeType: a.type || 'application/octet-stream',
          uploadedAt: body.source.date || '未提供', humanDescription: a.description, contentInspected: false})),
        departmentCandidates: departments,
        ruleContext: {version: health.analysis.rules, confirmedCategoryReadOnly: e.category || null, factHypothesisSeparationRequired: true},
        productKnowledge: {version: health.analysis.knowledge,
          statements: context.V0_CATEGORY_DICTIONARY.categories.map(c => `${c.primaryLabel}：${c.primaryDefinition}`)},
        runMetadata: {requestId: body.requestId, promptVersion: health.analysis.promptVersion,
          modelConfigId: contracts.QUALITY_ANALYSIS_MODEL_CONFIG_ID, requestedBy: 'local-ui-sample:quality-management', requestedAt: new Date().toISOString()},
      });
      const result = await new tongModel.QwenQualityAnalysisModel(config).generate(input);
      const validation = validator.validateQualityAnalysisOutput(input, result.payload);
      if (!validation.ok) throw Object.assign(new Error('原系统校验未通过'), {code: 'MODEL_OUTPUT_INVALID', validationIssues: validation.issues});
      return {input, output: validation.output, model: result.trace.model, usage: result.trace.tokenUsage,
        promptVersion: health.analysis.promptVersion};
    },
  };
}
