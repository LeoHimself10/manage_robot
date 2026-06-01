import type { AgentMetricsChannel } from "../../infra/agent-metrics-store";
import { assertAssistantMessageQuality } from "../eval/assistant-quality";
import type { OrchestratorResult } from "../orchestrator";
import {
  detectFalsePublish,
  detectFalsePublishOnConfirm,
} from "../publish-staging";

export function buildTurnMetricFlags(input: {
  userMessage: string;
  orchResult: OrchestratorResult;
  preTurnDraft?: Record<string, unknown>;
  outboundMarkdown: string;
  publishOk?: boolean;
  channel: AgentMetricsChannel;
}): string[] {
  const flags = [...(input.orchResult.observabilityFlags ?? [])];

  const falsePublish =
    detectFalsePublish({
      userMessage: input.userMessage,
      preTurnLatestDraft: input.preTurnDraft,
      toolInvocationNames: input.orchResult.toolInvocationNames ?? [],
      hasPublishResult: Boolean(input.publishOk),
      outboundMarkdown: input.outboundMarkdown,
    })
    || detectFalsePublishOnConfirm({
      userMessage: input.userMessage,
      preTurnLatestDraft: input.preTurnDraft,
      toolInvocationNames: input.orchResult.toolInvocationNames ?? [],
      hasPublishResult: Boolean(input.publishOk),
      outboundMarkdown: input.outboundMarkdown,
    });
  if (falsePublish) {
    flags.push("false_publish_observed");
  }

  const hygieneIssues = assertAssistantMessageQuality(input.outboundMarkdown, {
    draftAlreadyExists: Boolean(input.orchResult.draft),
  });
  if (hygieneIssues.length > 0) {
    flags.push("dingtalk_tool_name_leak");
  }

  return [...new Set(flags)];
}
