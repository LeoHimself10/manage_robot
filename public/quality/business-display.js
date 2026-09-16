// Presentation only. Original source keys and AI snapshots remain unchanged.
(function (root) {
  const labels = Object.freeze({SOURCE_SNAPSHOT:'来源反馈', FEEDBACK:'来源反馈', AI_ORIGINAL_ASSESSMENT:'AI 原始研判', MANAGER_ASSESSMENT:'主管最终研判', HISTORICAL_CASE:'历史案例', QUALITY_RULE:'质量规则', PRODUCT_KNOWLEDGE:'产品资料', HUMAN_ATTACHMENT_DESCRIPTION:'附件人工说明'});
  function text(value) {
    return String(value ?? '')
      .replace(/[\[〔【]\s*oa:[^\]〕】\r\n]+[\]〕】]/g, '〔来源反馈〕')
      .replace(/\boa:[A-Za-z0-9_+\/-]+={0,2}/g, '来源反馈')
      .replace(/\b(?:SOURCE_SNAPSHOT|FEEDBACK|AI_ORIGINAL_ASSESSMENT|MANAGER_ASSESSMENT|HISTORICAL_CASE|QUALITY_RULE|PRODUCT_KNOWLEDGE|HUMAN_ATTACHMENT_DESCRIPTION)\b/g, key => labels[key]);
  }
  function reference(type, value) {
    const label = labels[type] || '参考资料';
    if (/^(?:oa:|feedback:|dingtalk-oa:)/.test(String(value || ''))) return label;
    const readable = text(value);
    return readable && readable !== label ? label + ' · ' + readable : label;
  }
  root.QualityBusinessDisplay = Object.freeze({text, reference});
})(globalThis);
