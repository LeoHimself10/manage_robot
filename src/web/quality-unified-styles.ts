// Shared presentation for manager/employee quality pages. No task state is copied.
export const QUALITY_UNIFIED_STYLES = String.raw`
:root{--qpc-blue:#245fc2;--qpc-bg:#f3f5f8;--qpc-line:#d8e3f3;--qpc-ink:#18314f;--qpc-muted:#6d819e}
.wb-main-body--quality-center{background:#f3f5f8;padding:24px 32px 48px}
.qpc-unified{max-width:1500px;font-size:14px;position:relative}
.qpc-unified .qpc-eyebrow,.qpc-unified .qpc-caps{display:none}
.qpc-unified .qpc-hero{padding:0;margin:0 0 24px;border:0;box-shadow:none;background:transparent;min-height:70px}
.qpc-unified .qpc-hero h1{font-size:24px;margin:0 0 8px;color:#18314f}
.qpc-unified .qpc-hero p{font-size:14px;line-height:1.7}
.qpc-unified .qpc-center{padding:0;border:0;background:transparent;border-radius:0}
.qpc-unified .qpc-heading{position:absolute;right:0;top:48px;margin:0}
.qpc-unified .qpc-heading>div{display:none}
.qpc-unified .qpc-panel{box-shadow:none;border-radius:10px}
.qpc-unified .qpc-panel-head{display:none}
.qpc-unified .qpc-panel-body{padding:18px 20px}
.qpc-unified .qpc-metrics{display:block;margin:0;border:1px solid var(--qpc-line);border-bottom:0;border-radius:10px 10px 0 0;background:white}
.qpc-unified .qpc-metric-group{border:0;padding:0;background:none}
.qpc-unified .qpc-metric-group>header{display:none}
.qpc-unified .qpc-metric-grid,.qpc-unified .qpc-metric-group:only-child .qpc-metric-grid{display:flex;flex-wrap:wrap;gap:0;padding:0 14px}
.qpc-unified .qpc-metric{display:flex;align-items:center;gap:8px;min-height:54px;padding:12px 16px;border:0;border-bottom:3px solid transparent;border-radius:0;box-shadow:none;background:transparent;transform:none;white-space:nowrap}
.qpc-unified .qpc-metric span{font-size:14px;color:#637a9a}
.qpc-unified .qpc-metric strong{font-size:12px;font-weight:500;margin:0;background:#eef3fa;border-radius:4px;padding:2px 6px;color:#637a9a}
.qpc-unified .qpc-metric small,.qpc-unified .qpc-metric em{display:none}
.qpc-unified .qpc-metric.is-active{border-bottom-color:#245fc2;background:#f7faff}
.qpc-unified .qpc-metric.is-active span{color:#245fc2;font-weight:600}
.qpc-unified .qpc-metric:hover{background:#f4f8ff;box-shadow:none;transform:none}
.qpc-unified .qpc-panel{border-radius:0 0 10px 10px}
.qpc-unified .qpc-toolbar{gap:10px;margin-bottom:20px}
.qpc-unified .qpc-toolbar input{flex:1;min-width:160px}
.qpc-unified .qpc-toolbar input,.qpc-unified .qpc-toolbar select,.qpc-unified .btn{min-height:42px;border-radius:7px;font-size:14px}
.qpc-unified .btn-primary{background:#245fc2;border-color:#245fc2;box-shadow:none;color:#fff}
.qpc-unified .btn-primary:hover:not(:disabled){background:#194fab;border-color:#194fab}
.qpc-unified .btn-secondary{background:white;border:1px solid #c5d6ef;color:#234365;box-shadow:none}
.qpc-unified .qpc-table-wrap{overflow:visible}
.qpc-unified .qpc-table{min-width:0;width:100%;table-layout:fixed}
.qpc-unified .qpc-table th{background:#f5f8fc;color:#677f9f;font-size:13px;font-weight:500}
.qpc-unified .qpc-table td{font-size:14px;vertical-align:top;overflow-wrap:anywhere}
.qpc-unified .qpc-table th:first-child{width:18%}
.qpc-unified .qpc-table th:nth-child(2){width:27%}
.qpc-unified .qpc-table th:nth-child(3){width:18%}
.qpc-unified .qpc-table th:nth-child(4){width:15%}
.qpc-unified .qpc-table th:nth-child(5){width:9%}
.qpc-unified .qpc-table th:nth-child(6){width:13%}
.qpc-unified .qpc-table th:last-child,.qpc-unified .qpc-table tr:not(.qpc-inline-detail)>td:last-child:not([colspan]){display:none}
.qpc-unified .qpc-assignment-line + .qpc-assignment-line{margin-top:8px}
.qpc-unified .qpc-assignment-excerpt{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:1.65;max-height:3.3em;overflow-wrap:anywhere}
.qpc-unified .qpc-table tr.is-active{background:#edf4ff}
.qpc-unified .qpc-link{color:#245fc2;text-align:left;white-space:normal}
.qpc-unified .qpc-inline-detail>td{padding:0!important;background:#f8fbff;border:0}
.qpc-unified .qpc-workspace{margin:0 0 16px;border:1px solid #c9daf3;border-left:3px solid #245fc2;border-radius:0;box-shadow:none;overflow:hidden;max-height:none}
.qpc-unified .qpc-workbar{background:#fff;color:#18314f;padding:22px 24px;border-bottom:1px solid var(--qpc-line);min-height:0;box-shadow:none}
.qpc-unified .qpc-workbar::before,.qpc-unified .qpc-workbar::after{display:none}
.qpc-unified .qpc-workbar h3{font-size:14px;color:#6681a4;font-weight:500}
.qpc-unified .qpc-workbar p{font-size:20px;line-height:1.5;color:#18314f;font-weight:600;margin:8px 0 0}
.qpc-unified .qpc-work-badges>span{border:1px solid #d8e3f3;background:#f3f7fc;color:#466b9f;font-size:12px}
.qpc-unified .qpc-stages{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));overflow:visible;background:#f9fbfe;border-bottom:1px solid var(--qpc-line)}
.qpc-unified .qpc-stage{min-width:0;min-height:78px;padding:12px 8px;background:transparent;border-color:#dde7f4;color:#6c819c;box-shadow:none}
.qpc-unified .qpc-stage b{font-size:14px;color:inherit}
.qpc-unified .qpc-stage small{font-size:12px;color:#8193ad}
.qpc-unified .qpc-stage.is-active{color:#245fc2;background:#edf4ff;border-bottom-color:#245fc2;box-shadow:inset 0 -3px #245fc2}
.qpc-unified .qpc-stage-number{background:white;color:#7b93b2;border:1px solid #d2e0f3;font-size:12px}
.qpc-unified .qpc-stage.is-active .qpc-stage-number{background:#245fc2;color:white;border-color:#245fc2}
.qpc-unified .qpc-work-content{padding:24px;background:#fff;max-height:none;overflow:visible}
.qpc-unified .qpc-manager-responsibility>.qpc-section-head{display:none}
.qpc-unified .qpc-block-title{font-size:18px;margin:0 0 18px}
.qpc-unified .qpc-test-actions,.qpc-unified .qpc-record-card,.qpc-unified .qpc-card,.qpc-unified .qpc-responsibility-root,.qpc-unified .qpc-quality-task,.qpc-unified .qpc-review-gate{background:#fff;border:1px solid var(--qpc-line);box-shadow:none;border-radius:8px}
.qpc-unified .qpc-test-actions{padding:0;border:0;margin:0}
.qpc-unified .qpc-test-actions>h4{display:none}
.qpc-unified .qpc-notice{background:#f5f8fd;border:1px solid #d8e4f4;border-radius:6px;color:#607b9d;line-height:1.7;font-size:14px}
.qpc-unified .qpc-fact-grid{gap:14px;border:0;background:white;margin:18px 0}
.qpc-unified .qpc-fact{background:#f8fafd;border:1px solid #e3ebf7;border-radius:6px;padding:12px 14px}
.qpc-unified .qpc-fact label{font-size:12px;color:#778da9}
.qpc-unified .qpc-fact strong{font-size:14px;font-weight:500;color:#213d60}
.qpc-unified .qpc-event-summary-grid{display:none}
.qpc-unified .qpc-judgment-layout{display:flex;flex-direction:column}
.qpc-unified .qpc-responsibility-root-mark,.qpc-unified .qpc-parallel-head::before{display:none}
.qpc-unified .qpc-responsibility-root-identity{background:#f5f8fe;padding:16px}
.qpc-unified .qpc-responsibility-root-identity h4{font-size:16px}
.qpc-unified .qpc-parallel-head{padding:18px 0 10px}
.qpc-unified .qpc-quality-task-summary{background:#f8fafd}
.qpc-unified .qpc-quality-task-body{padding:18px}
.qpc-unified small{font-size:12px}
.qpc-unified .qpc-tag.orange{background:#fff8eb;border-color:#f0dfbe;color:#a77925}
.qpc-view-switch{position:absolute;right:0;top:0;z-index:20}
.qpc-view-switch>summary{cursor:pointer;list-style:none;padding:8px 14px;border:1px solid #c8d8ed;border-radius:7px;background:white;color:#234365;font-size:14px}
.qpc-view-switch>summary::after{content:'⌄';margin-left:12px}
.qpc-view-switch .qpc-perspective-tabs{position:absolute;right:0;top:42px;width:220px;padding:8px;display:grid;background:#fff;box-shadow:0 6px 20px #18314f18;border:1px solid #d5e2f4;z-index:20}
.qpc-view-switch .qpc-perspective-tabs a{justify-content:flex-start;min-height:42px;font-weight:500}
.qpc-view-switch .qpc-perspective-tabs a.is-active{background:#edf4ff;border-color:#d5e2f4;color:#245fc2;box-shadow:none}
@media(max-width:1050px){.wb-main-body--quality-center{padding:20px 16px}.qpc-unified .qpc-stages{grid-template-columns:repeat(3,minmax(0,1fr))}.qpc-unified .qpc-table th:nth-child(4),.qpc-unified .qpc-table tr:not(.qpc-inline-detail)>td:nth-child(4){display:none}.qpc-unified .qpc-work-content{padding:18px}.qpc-unified .qpc-metric{padding:10px 12px}}
@media(max-width:650px){.qpc-unified .qpc-hero{padding-top:50px}.qpc-unified .qpc-heading{top:0;right:120px}.qpc-unified .qpc-table th:nth-child(3),.qpc-unified .qpc-table tr:not(.qpc-inline-detail)>td:nth-child(3){display:none}.qpc-unified .qpc-panel-body{padding:12px}.qpc-unified .qpc-fact-grid{grid-template-columns:1fr}.qpc-unified .qpc-stage{min-height:68px}.qpc-unified .qpc-stage-number{display:none}}
`;
