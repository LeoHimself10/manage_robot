// Display labels generated from the original system HISTORICAL_FEEDBACK_TAXONOMY_V0.
// Rendering never changes the stored source or AI snapshot.
const oaAiFieldLabels = Object.freeze({
  error_code_or_message:'错误代码或屏幕提示',
  error_code:'错误代码', error_message:'错误提示',
  physical_inspection_result:'导管实物检查结果',
  inspection_result:'检查结果', failure_stage:'故障发生阶段',
  reproduction_steps:'复现步骤', software_version:'软件版本',
  device_model:'设备型号', serial_number:'设备序列号',
  catheter_batch:'导管生产批号', operating_steps:'操作步骤',
  occurrence_time:'故障发生时间', impact_assessment:'影响评估',
});
const oaAiCategoryAliases = {
  PIU_LOAD_RECOGNITION:['PIU装载识别','装载识别'],
  PIU_POWER_COUPLING:['光学耦合'],
  CATHETER_PRODUCT:['导管本体故障'],
};
function oaAiBusinessText(value) {
  let text=String(value??'');
  for(const [code,label] of Object.entries(oaAiCategoryLabels)) {
    for(const alias of [label,...(oaAiCategoryAliases[code]||[])]) {
      // Remove a redundant machine annotation only when its business label is present.
      // A standalone code is translated below, so no diagnostic meaning is lost.
      for(const [open,close] of [['(',')'],['（','）']])text=text.split(alias+open+code+close).join(alias);
    }
  }
  return text.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g,code=>oaAiCategoryLabels[code]||code)
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g,key=>oaAiFieldLabels[key]||key);
}
function oaAiBusinessLabel(value) {
  const raw=String(value??'').trim();
  if(oaAiFieldLabels[raw])return oaAiFieldLabels[raw];
  // Free-form model field identifiers have no validated Chinese label. Keep
  // their explanatory reason visible, without exposing an untranslated key.
  if(/^[A-Za-z][A-Za-z0-9_.]*$/.test(raw)&&(/[_\.]/.test(raw)||/[a-z][A-Z]/.test(raw)))return '';
  return oaAiBusinessText(raw);
}
function renderOaAiBusinessResult(data) {
  const output=data.output;
  const clean=value=>esc(oaAiBusinessText(value));
  const basis=[...new Set((output.reasoningBasis||[]).map(item=>oaAiBusinessText(item.statement)).filter(Boolean))];
  const section=(title,items)=>items.length?'<section class="ai-business-section"><h3>'+title+'</h3><ul>'+items.join('')+'</ul></section>':'';
  const information=items=>(items||[]).map(item=>{
    const label=oaAiBusinessLabel(item.field??item.topic),reason=oaAiBusinessText(item.reason);
    if(!label&&!reason)return '';
    return '<li>'+(label?'<strong>'+esc(label)+'</strong>':'')+(reason?'<p>'+esc(reason)+'</p>':'')+'</li>';
  }).filter(Boolean);
  return '<div class="ai-result"><div class="facts">'
    +fact('建议分类',oaAiBusinessText(data.category.primary+' / '+data.category.secondary))
    +fact('建议风险',risk[output.riskLevel]||'待确认')
    +fact('建议处理',handling[output.handlingRecommendation]||'待确认')+'</div>'
    +section('判断依据',basis.map(statement=>'<li><p>'+clean(statement)+'</p></li>'))
    +section('需要补充的资料',information(output.missingInformation))
    +section('还需核实的问题',information(output.uncertainties))
    +'<details class="raw-fields"><summary>生成记录</summary>'
    +fact('生成时间',fmt(data.createdAt))+fact('依据资料','OA 资料 V'+data.sourceVersion)+'</details></div>';
}
const oaAiCategoryLabels = Object.freeze({
  "CATHETER_PRODUCT": "导管本体",
  "CATHETER_BREAKAGE": "断裂、折断与脱落",
  "CATHETER_BEND_SHAKE": "弯折、扭曲与旋转异常",
  "CATHETER_PASSAGE_SHAPE": "通过性与头端形态",
  "CATHETER_MATERIAL_OTHER": "材料、涂层及其他导管问题",
  "IMAGING_OPTICS": "成像与光学表现",
  "IMAGE_DARK": "成像暗或信号弱",
  "IMAGE_BLUR_COLOR": "模糊、颜色与伪影",
  "IMAGE_SHAKE_NURD": "图像抖动或NURD",
  "IMAGE_NONE_INTERRUPTED": "无法成像或成像中断",
  "PIU_CONNECTION": "PIU、连接与装载",
  "PIU_LOAD_RECOGNITION": "装载、识别与错误码",
  "PIU_POWER_COUPLING": "功率、0dB与光学耦合",
  "PIU_HARDWARE_ALIGNMENT": "对中、顶针、滑环及连接硬件",
  "HOST_HARDWARE": "主机硬件与配件",
  "HARDWARE_DISPLAY": "显示器与屏幕",
  "HARDWARE_POWER_INTERFACE": "电源、线缆与接口",
  "HARDWARE_MECHANICAL_ACCESSORY": "机械结构与外部配件",
  "SOFTWARE_DATA": "软件与数据功能",
  "SOFTWARE_STABILITY_ERROR": "稳定性、重启与报错",
  "SOFTWARE_DATA_MEASUREMENT": "数据、报告与测量",
  "SOFTWARE_FEATURE_CONFIG": "功能、界面、配置与网络",
  "OPERATION_SERVICE": "操作、培训与维护",
  "OPERATION_USE_LOAD": "使用、连接、装载与校准",
  "OPERATION_TRAINING_MAINTENANCE": "培训、维护与保养",
  "OPERATION_TRANSPORT_STORAGE": "运输、搬运与存储",
  "CLINICAL_PATIENT": "临床与患者因素",
  "CLINICAL_ANATOMY_PATIENT": "患者、血管与病变因素",
  "CLINICAL_SAFETY_COMPATIBILITY": "临床安全与术式兼容性",
  "PACKAGING_PROCESS": "包装、生产与供应",
  "PACKAGE_LABEL": "包装、标签与外观",
  "PROCESS_ASSEMBLY": "生产、装配与工艺",
  "SUPPLIER_MATERIAL": "来料、供应商与材料",
  "OTHER_UNCLEAR": "其他与待确认",
  "INSUFFICIENT_INFO": "信息不足或无法判断",
  "OTHER_GENERAL": "其他一般反馈"
});
