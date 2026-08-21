import type { AiCategoryDictionary } from "./ai-original-assessment-contracts";

export const HISTORICAL_FEEDBACK_TAXONOMY_VERSION =
  "HISTORICAL_FEEDBACK_TAXONOMY_V0" as const;

/**
 * 基于1664条历史反馈复核后固定的V0两级分类字典。
 *
 * 使用原则：
 * 1. 优先描述当前反馈中能够直接观察或确认的主要问题；
 * 2. 操作、临床、生产或供应商等原因类分类，只有在输入中有明确事实支持时才使用；
 * 3. 同一条反馈只能选择一个最主要分类；多个独立问题混在一条记录且无法确定主问题时，
 *    选择 OTHER_UNCLEAR / INSUFFICIENT_INFO，交由人工拆分或补充资料。
 */
export const HISTORICAL_FEEDBACK_TAXONOMY_V0 = {
  version: HISTORICAL_FEEDBACK_TAXONOMY_VERSION,
  categories: [
    {
      primaryCode: "CATHETER_PRODUCT",
      primaryLabel: "导管本体",
      primaryDefinition: "导管、光纤、外管、头端或导丝腔本身的物理、形态、材料及通过性问题。",
      secondaryCategories: [
        {
          secondaryCode: "CATHETER_BREAKAGE",
          secondaryLabel: "断裂、折断与脱落",
          definition: "导管、光纤、弹簧管、外管或连接处已经断裂、折断、开裂或脱落。",
          applicableScope: ["可见断裂或折断", "光纤或内核开裂", "导管部件脱落或连接处分离"],
          excludedScope: ["只有弯折但没有断裂", "仅显示导管异常提示但未确认物理损坏", "已确认是操作、生产或运输原因且主问题是原因复盘"],
          typicalExpressions: ["导管折断", "光纤断裂", "外管开裂", "弹簧管脱落", "连接处断开"],
        },
        {
          secondaryCode: "CATHETER_BEND_SHAKE",
          secondaryLabel: "弯折、扭曲与旋转异常",
          definition: "导管轴体、中段、内核或弹簧管发生弯折、扭曲、麻花状、抖动，或确认由导管造成的NURD。",
          applicableScope: ["可见导管轴体或中段弯折、扭曲", "内核或弹簧管抖动", "确认根因在导管的NURD或旋转异常"],
          excludedScope: ["只有头端、尖端、出水口或远端标记段局部形态异常", "只有图像抖动且根因不明", "三维标注或算法结果呈麻花状", "导管已经断裂"],
          typicalExpressions: ["导管轴体弯折", "弹簧管扭曲", "导管抖动", "导管NURD", "内核麻花状"],
        },
        {
          secondaryCode: "CATHETER_PASSAGE_SHAPE",
          secondaryLabel: "通过性与头端形态",
          definition: "导管无法通过、推送阻力异常，或头端、尖端、出水口、导丝腔、远端标记段发生局部弯折或其他形态异常。",
          applicableScope: ["无法送入或通过病变", "头端过硬或贴合异常", "尖端、出水口、导丝腔或远端标记段局部弯折变形"],
          excludedScope: ["导管轴体或中段整体弯折、扭曲", "明确由患者血管迂曲、钙化等解剖因素造成", "已经断裂", "仅为一般操作方法问题"],
          typicalExpressions: ["导管无法通过", "推送阻力大", "头端弯折", "出水口变形", "鱼嘴效应", "导丝腔异常"],
        },
        {
          secondaryCode: "CATHETER_MATERIAL_OTHER",
          secondaryLabel: "材料、涂层及其他导管问题",
          definition: "导管涂层、胶水、材料、尺寸、密封、渗漏或无法归入更具体导管类别的本体问题。",
          applicableScope: ["涂层或润滑异常", "材料、尺寸、胶水或密封异常", "导管漏液、污染或其他本体缺陷"],
          excludedScope: ["断裂、弯折或通过性已有明确专类", "只有成像现象", "只有导管异常提示且未确认本体缺陷"],
          typicalExpressions: ["涂层脱落", "导管漏液", "胶水异常", "外管材料异常", "探头表面损伤"],
        },
      ],
    },
    {
      primaryCode: "IMAGING_OPTICS",
      primaryLabel: "成像与光学表现",
      primaryDefinition: "以图像、亮度、清晰度、伪影或信号中断为主要现象，且尚未明确到具体硬件或导管根因的问题。",
      secondaryCategories: [
        {
          secondaryCode: "IMAGE_DARK",
          secondaryLabel: "成像暗或信号弱",
          definition: "仍可成像但图像偏暗、亮度不足、穿透力弱或光信号偏弱。",
          applicableScope: ["图像偏暗", "亮度或穿透力不足", "光信号弱但仍有图像"],
          excludedScope: ["完全无图像或成像中断", "颜色、亮环或模糊为主要现象", "已确认PIU功率或耦合故障"],
          typicalExpressions: ["成像暗", "图像偏暗", "亮度不足", "穿透力弱", "信号偏弱"],
        },
        {
          secondaryCode: "IMAGE_BLUR_COLOR",
          secondaryLabel: "模糊、颜色与伪影",
          definition: "图像模糊、颜色异常、固定亮环、闪烁亮点、伪影或测量边界不清。",
          applicableScope: ["图像模糊或不清晰", "颜色异常", "固定亮环、亮点或其他伪影"],
          excludedScope: ["主要是图像抖动或NURD", "完全无法成像", "已确认是软件算法或数据输出问题"],
          typicalExpressions: ["图像不清晰", "成像模糊", "颜色异常", "固定亮环", "图像伪影"],
        },
        {
          secondaryCode: "IMAGE_SHAKE_NURD",
          secondaryLabel: "图像抖动或NURD",
          definition: "图像出现抖动、锯齿或旋转伪影，但尚未确认具体导管或PIU根因。",
          applicableScope: ["图像抖动", "旋转伪影", "影像NURD且根因不明"],
          excludedScope: ["已确认导管弯折或弹簧管异常", "已确认PIU滑环或对中硬件异常", "仅有算法标注形态异常"],
          typicalExpressions: ["图像抖动", "图像有锯齿", "旋转伪影", "NURD现象"],
        },
        {
          secondaryCode: "IMAGE_NONE_INTERRUPTED",
          secondaryLabel: "无法成像或成像中断",
          definition: "无图像、无法成像、成像过程突然中断或信号消失。",
          applicableScope: ["完全无图像", "成像中断", "回拉过程中信号消失"],
          excludedScope: ["仍有图像但偏暗或模糊", "已确认装载识别错误码", "已确认物理断裂或弯折是主问题"],
          typicalExpressions: ["无法成像", "没有图像", "无影像", "成像中断", "信号消失"],
        },
      ],
    },
    {
      primaryCode: "PIU_CONNECTION",
      primaryLabel: "PIU、连接与装载",
      primaryDefinition: "PIU装载、导管识别、光学耦合、对中、滑环、顶针和连接部件相关问题。",
      secondaryCategories: [
        {
          secondaryCode: "PIU_LOAD_RECOGNITION",
          secondaryLabel: "装载、识别与错误码",
          definition: "导管装载失败、无法识别、校准阶段失败，或出现1201、1202、1203、1211等装载识别错误。",
          applicableScope: ["导管无法装载或识别", "导管损坏或更换导管提示", "1201、1202、1203、1211等错误码", "装载后的校准失败"],
          excludedScope: ["已确认是PIU功率或耦合问题", "已确认对中、顶针、滑环或接口硬件损坏", "纯软件功能或界面问题"],
          typicalExpressions: ["1201报错", "1202报错", "导管识别异常", "装载失败", "提示更换导管"],
        },
        {
          secondaryCode: "PIU_POWER_COUPLING",
          secondaryLabel: "功率、0dB与光学耦合",
          definition: "PIU输出功率、0dB、红光或导管与PIU光学耦合效率异常。",
          applicableScope: ["PIU输出功率低", "0dB异常", "无红光", "耦合传输效率低或光衰减严重"],
          excludedScope: ["只有图像偏暗且未确认PIU原因", "仅装载或识别错误", "明确的接口机械损坏"],
          typicalExpressions: ["PIU功率低", "0dB异常", "无红光", "耦合效率低", "光衰减严重"],
        },
        {
          secondaryCode: "PIU_HARDWARE_ALIGNMENT",
          secondaryLabel: "对中、顶针、滑环及连接硬件",
          definition: "PIU对中、顶针、滑环、针尖、水晶头、固定座或连接硬件异常。",
          applicableScope: ["对中或顶针异常", "滑环、固定座或锁紧机构异常", "水晶头、接口或连接部件物理异常"],
          excludedScope: ["主机显示器、电源或外部配件", "只有错误码但未确认硬件原因", "导管本体断裂或弯折"],
          typicalExpressions: ["PIU顶针弯曲", "滑环异常", "水晶头损伤", "固定座松动", "PIU锁不住"],
        },
      ],
    },
    {
      primaryCode: "HOST_HARDWARE",
      primaryLabel: "主机硬件与配件",
      primaryDefinition: "主机、显示系统、电源线缆、工控机及外部机械配件问题，不含PIU和导管本体。",
      secondaryCategories: [
        {
          secondaryCode: "HARDWARE_DISPLAY",
          secondaryLabel: "显示器与屏幕",
          definition: "显示器、屏幕、视频输出、分屏器或显示连接异常。",
          applicableScope: ["显示器或屏幕损坏", "无显示或No Signal", "分屏器、视频输出或显示连接异常"],
          excludedScope: ["屏幕只是显示导管错误提示", "软件界面功能异常", "PIU或导管问题"],
          typicalExpressions: ["显示器破损", "屏幕黑屏", "No Signal", "分屏器异常", "视频输出异常"],
        },
        {
          secondaryCode: "HARDWARE_POWER_INTERFACE",
          secondaryLabel: "电源、线缆与接口",
          definition: "主机电源、工控机、线缆、插口、接口、内存或采集卡接触通信硬件异常。",
          applicableScope: ["无法开机或电源异常", "主机线缆、插口或接口接触不良", "工控机、内存或采集卡硬件异常"],
          excludedScope: ["PIU连接硬件", "显示器自身故障", "仅软件卡顿或报错"],
          typicalExpressions: ["无法开机", "电源线异常", "接口松动", "工控机异常", "内存松动"],
        },
        {
          secondaryCode: "HARDWARE_MECHANICAL_ACCESSORY",
          secondaryLabel: "机械结构与外部配件",
          definition: "主机脚轮、键鼠、航空箱、刹车、支架、外壳等机械结构或外部配件异常。",
          applicableScope: ["主机或航空箱脚轮", "键盘、鼠标和托板", "刹车、支架、外壳或其他外部配件"],
          excludedScope: ["PIU固定座或锁紧部件", "导管内核或外管", "工控机内部电气部件"],
          typicalExpressions: ["脚轮损坏", "键鼠故障", "航空箱破损", "刹车失效", "支架松动"],
        },
      ],
    },
    {
      primaryCode: "SOFTWARE_DATA",
      primaryLabel: "软件与数据功能",
      primaryDefinition: "软件稳定性、数据、报告、测量、算法识别、界面、配置、网络和升级问题。",
      secondaryCategories: [
        {
          secondaryCode: "SOFTWARE_STABILITY_ERROR",
          secondaryLabel: "稳定性、重启与报错",
          definition: "软件卡顿、死机、崩溃、异常重启或非装载识别类软件报错。",
          applicableScope: ["软件卡顿、死机或崩溃", "系统或软件自动重启", "非装载识别类软件错误码"],
          excludedScope: ["主要是数据、报告或分析结果错误", "1201、1202、1203等装载识别错误", "明确的主机硬件故障"],
          typicalExpressions: ["软件崩溃", "系统重启", "程序卡死", "蓝屏", "583报错"],
        },
        {
          secondaryCode: "SOFTWARE_DATA_MEASUREMENT",
          secondaryLabel: "数据、报告与测量",
          definition: "数据保存、导出、报告、测量、分析算法或自动识别结果异常。",
          applicableScope: ["数据保存或导出异常", "报告、测量或分析失败", "算法漏识别、误识别或结果不一致"],
          excludedScope: ["软件整体卡死或崩溃", "纯界面入口或参数配置", "导管装载校准阶段错误"],
          typicalExpressions: ["导出失败", "分析失败", "测量结果不一致", "自动识别错误", "报告异常"],
        },
        {
          secondaryCode: "SOFTWARE_FEATURE_CONFIG",
          secondaryLabel: "功能、界面、配置与网络",
          definition: "软件功能入口、界面交互、参数配置、账号、网络或升级相关问题。",
          applicableScope: ["功能不可用或入口异常", "界面交互或显示逻辑异常", "参数、账号、网络或升级配置问题"],
          excludedScope: ["算法识别或测量结果错误", "软件崩溃或重启", "屏幕仅显示硬件或导管错误提示"],
          typicalExpressions: ["功能入口异常", "界面配置错误", "账号无法登录", "网络连接失败", "升级后异常"],
        },
      ],
    },
    {
      primaryCode: "OPERATION_SERVICE",
      primaryLabel: "操作、培训与维护",
      primaryDefinition: "有明确事实支持的使用操作、培训维护、运输搬运或存储原因。",
      secondaryCategories: [
        {
          secondaryCode: "OPERATION_USE_LOAD",
          secondaryLabel: "使用、连接、装载与校准",
          definition: "已确认或有直接证据表明由现场使用、连接、装载、校准或污染操作导致的问题。",
          applicableScope: ["连接、装载或校准方式不当", "导管跌落、碰地或污染", "操作步骤错误且指导后恢复"],
          excludedScope: ["仅推测为人为操作", "已确认是生产执行问题", "硬件或导管本体故障"],
          typicalExpressions: ["操作不当", "连接未到位", "校准方向错误", "导管掉落", "碰地污染"],
        },
        {
          secondaryCode: "OPERATION_TRAINING_MAINTENANCE",
          secondaryLabel: "培训、维护与保养",
          definition: "培训不足、维护保养、清洁、检修或使用规范执行问题。",
          applicableScope: ["培训后问题消失", "清洁、维护或保养不到位", "需要补充检修或使用规范"],
          excludedScope: ["单次现场操作失误", "已确认PIU功率或连接硬件缺陷", "生产工艺或供应商问题"],
          typicalExpressions: ["需要培训", "清洁后恢复", "维护不到位", "保养不当", "检修不及时"],
        },
        {
          secondaryCode: "OPERATION_TRANSPORT_STORAGE",
          secondaryLabel: "运输、搬运与存储",
          definition: "运输、搬运、跌落、挤压、存放或环境条件造成的设备或产品问题。",
          applicableScope: ["物流运输或周转碰撞", "搬运造成松动或损坏", "存储温湿度、挤压或环境影响"],
          excludedScope: ["术中或无菌区内的导管掉落", "没有运输证据的硬件松动", "包装自身质量问题"],
          typicalExpressions: ["运输碰撞", "搬运后异常", "物流周转", "存放不当", "运输振动"],
        },
      ],
    },
    {
      primaryCode: "CLINICAL_PATIENT",
      primaryLabel: "临床与患者因素",
      primaryDefinition: "患者解剖、病变、临床安全变化或与其他器械和术式的兼容性问题。",
      secondaryCategories: [
        {
          secondaryCode: "CLINICAL_ANATOMY_PATIENT",
          secondaryLabel: "患者、血管与病变因素",
          definition: "有明确事实表明问题主要由患者配合、血管迂曲、钙化、狭窄、夹层、痉挛或病变造成。",
          applicableScope: ["患者躁动或无法配合", "血管迂曲、钙化或严重狭窄", "病变或解剖条件导致无法通过或成像"],
          excludedScope: ["只是怀疑患者因素", "明确的导管本体缺陷", "生命体征或临床安全事件"],
          typicalExpressions: ["血管迂曲", "钙化病变", "患者躁动", "病变狭窄", "患者原因"],
        },
        {
          secondaryCode: "CLINICAL_SAFETY_COMPATIBILITY",
          secondaryLabel: "临床安全与术式兼容性",
          definition: "生命体征变化、严重临床安全事件、术式策略改变或与其他器械/术式不兼容。",
          applicableScope: ["生命体征或严重安全变化", "手术策略改变", "与球囊、支架、导丝、IVUS等器械或术式不兼容"],
          excludedScope: ["单纯血管迂曲或钙化导致通过困难", "普通操作咨询", "产品自身断裂或成像故障"],
          typicalExpressions: ["发生室颤", "生命体征异常", "手术策略改变", "改用IVUS", "术式不兼容"],
        },
      ],
    },
    {
      primaryCode: "PACKAGING_PROCESS",
      primaryLabel: "包装、生产与供应",
      primaryDefinition: "包装标签、生产装配工艺、批次执行、供应商来料或材料质量问题。",
      secondaryCategories: [
        {
          secondaryCode: "PACKAGE_LABEL",
          secondaryLabel: "包装、标签与外观",
          definition: "包装破损、无菌袋、标签、说明书、外观或包装内附件缺失问题。",
          applicableScope: ["包装或无菌袋异常", "标签、说明书或标识错误", "开箱发现外观或附件缺失"],
          excludedScope: ["运输碰撞已被明确为原因", "导管本体材料缺陷", "生产装配过程问题"],
          typicalExpressions: ["包装破损", "无菌袋无法扣紧", "标签错误", "说明书缺失", "附件缺失"],
        },
        {
          secondaryCode: "PROCESS_ASSEMBLY",
          secondaryLabel: "生产、装配与工艺",
          definition: "有明确工程结论支持的生产、装配、粘接、焊接、工艺执行或批次问题。",
          applicableScope: ["生产或装配漏工序", "粘接、焊接或固化异常", "工艺执行、批次或检验问题"],
          excludedScope: ["只有可能或猜测的生产原因", "只有产品现象而无工程结论", "供应商来料或材料性能问题"],
          typicalExpressions: ["生产漏检", "装配不到位", "焊接异常", "胶水未固化", "工艺执行不到位"],
        },
        {
          secondaryCode: "SUPPLIER_MATERIAL",
          secondaryLabel: "来料、供应商与材料",
          definition: "有明确证据指向供应商来料、外购件、采购材料性能或供应质量的问题。",
          applicableScope: ["供应商来料不合格", "外购件批次异常", "采购材料性能不满足要求"],
          excludedScope: ["内部生产装配工艺", "导管材料现象但供应来源未确认", "仅提出供应商可能性"],
          typicalExpressions: ["来料不合格", "供应商批次异常", "外购件质量问题", "材料性能不达标"],
        },
      ],
    },
    {
      primaryCode: "OTHER_UNCLEAR",
      primaryLabel: "其他与待确认",
      primaryDefinition: "资料不足、多个独立问题无法确定主问题，或确认属于咨询建议等其他一般事项。",
      secondaryCategories: [
        {
          secondaryCode: "INSUFFICIENT_INFO",
          secondaryLabel: "信息不足或无法判断",
          definition: "缺少有效问题描述、只有附件文件名、明确写着原因不清，或多个问题混在一条记录无法确定主问题。",
          applicableScope: ["问题描述为空", "只有图片或视频文件名", "明确写着不清楚、无法分析或原因不明", "多个独立问题无法确定主问题"],
          excludedScope: ["已有足够现象可落入其他分类", "明确的非质量咨询或建议"],
          typicalExpressions: ["仅有视频文件名", "原因不清楚", "无法分析", "无问题描述", "需补充资料"],
        },
        {
          secondaryCode: "OTHER_GENERAL",
          secondaryLabel: "其他一般反馈",
          definition: "信息充分但确认不属于具体质量故障分类的咨询、建议、流程或低频其他事项。",
          applicableScope: ["普通咨询或建议", "延期报损等流程事项且已说明背景", "明确非质量问题并有足够说明"],
          excludedScope: ["因为资料不足而无法分类", "只有附件文件名", "能够归入任一具体产品、成像、硬件、软件、操作、临床或生产分类"],
          typicalExpressions: ["普通咨询", "改进建议", "流程反馈", "明确非质量问题", "其他低频事项"],
        },
      ],
    },
  ],
} satisfies AiCategoryDictionary;
