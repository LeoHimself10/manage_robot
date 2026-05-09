import { appendJsonlLine } from "../../infra/write-jsonl";

export interface MockManagerCardParams {
  traceId: string;
  outTrackId: string;
}

export function mockManagerCard(params: MockManagerCardParams): void {
  const path =
    process.env.CARD_CALLBACKS_PATH?.trim() || "./data/events/card-callbacks.jsonl";
  appendJsonlLine(path, {
    kind: "mock_manager_card",
    tsIso: new Date().toISOString(),
    traceId: params.traceId,
    outTrackId: params.outTrackId,
  });
}
