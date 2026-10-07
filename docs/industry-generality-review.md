# 行业通用性排查（2026-10-06）

目标：NocoHR 要能用于各行各业（零售连锁、医院、服务业、物流、办公室/科技、建筑……），而它是围绕一个制造业演示案例（启衡精密）做出来的。本文列出制造业假设写在了哪里，并给每一处一个处理方式：

- **改成可配置**：机制本身通用，但取值、规则或清单写死了。
- **改成中性用词**：只是措辞或示例偏工厂。
- **保留为制造业行业包**：确实属于制造业，应只在启用该行业包时出现。
- **已通用**：不用改。

演示数据（`*_demo_*` 种子，生产环境和 `HR_DEMO_SEED=false` 时不运行）属于启衡精密案例，保留制造业不算问题，本文不再逐条列出。

## 一、结论

1. **底座已经是通用的。** 部门是自由的树（没有固定的工厂/车间/班组层级）、职位职级、人事异动和清单、合同、自定义字段、排班与考勤规则、假期、薪资公式（计件和班次津贴都靠导入列和班次变量表达）、绩效方案、实操考核、"证书授予权限集"的机制，都不依赖行业。
2. **制造业假设集中在四类地方：**
   - 少数**写死的业务规则**：厂长审批人识别、人才库匹配时追加 CNC 关键词、借调必带住宿风险、同名部门只认"……工厂"。
   - **新装就带的默认值和种子**：CNC/叉车两个权限集和两张设备页面、同义词默认值、绩效排除"设备故障"、术语表、新员工回访的宿舍/班车问题。
   - **AI 员工的提示词和示例**：几乎每位 AI 员工都用车间、班组长、整车厂、CNC、首件检验做例子。
   - **界面措辞**：用工计划写成"排产计划 / 计划产量 / 件"，若干输入框占位符用工厂例子。
3. **第二个行业还缺三样机制**（持证上岗）：证书可解锁的页面/操作登记表、通用的"持证操作记录"、行业包的启用和停用。
4. **与行业无关、但限制适用范围的前提**（只列出，不在本次范围）：只接了飞书；薪资和合规按中国社保、个税和劳动合同法；AI 一律用简体中文回复。

## 二、写死的业务规则（优先修）

| 位置 | 现状 | 对其他行业的影响 | 处理 |
|---|---|---|---|
| `server/providers/hr/recruiting/assistant.ts:459` | 为招聘需求在人才库找人时，无条件追加"数控、CNC、加工中心、机床"作关键词 | 医院招护士也会按机加工词匹配，**这是缺陷** | 删除；关键词只取自需求清单和职位 |
| `server/providers/hr/settings-drafts.ts:159-196`；`server/ai/tools/hr-assistant-change-tools.ts:182` | "一句话改流程"里，`FACTORY_HEAD` 只认"厂长/工厂负责人"，`factoryOf` 只认名称以"工厂/厂"结尾的部门 | "院长审批""店长审批""区域经理审批"解析不到对应负责人 | 改成可配置：设置里维护"审批角色词 → 部门层级或名称规则"，或给部门加类型；工具描述同步改 |
| `server/providers/hr/index.ts:895-910`；`profile/audit.ts:214-226`；`client/components/talent/audit-requests.tsx:245-253` | 同名部门只在上级名称以"工厂"结尾时才加前缀区分 | 两个院区的"急诊科"无法区分 | 改成通用：同名时一律带上级名称 |
| `server/providers/hr/recruiting/workforce.ts:366` | 用工计划的"借调"方案总带"住宿"风险 | 没有宿舍的企业也会看到 | 改成可配置（招聘设置里勾选借调风险项） |
| `server/providers/hr/payroll/calc.ts:236,244` | 时薪 = 日薪 ÷ 8；计薪天数缺省 21.75 | 非 8 小时工作日算错 | 改成可配置：取考勤规则或薪资结构的标准日工时 |
| `server/providers/hr/adjustment-service.ts:119-125`；`schedule-validation.ts:46-58` | 没排班时按周一到周五算工作日 | 零售、服务业的休息日不同 | 改成可配置（每周休息日） |
| `server/providers/hr/talent-review/knowledge.ts:127-135` | AI 关闭时，任何报警码都命名为"CNC 报警 X 复位" | 非 CNC 设备也被叫 CNC | 改成中性："报警 X" |
| `server/providers/hr/talent-review/practicals.ts:517,522` | AI 关闭时，实操清单按"检验/操作/点检/安全""首件/禁止"等词分段和定关键项 | 医院、零售的操作规程分不出关键项 | 改成可配置（关键词清单进设置，行业包提供默认值） |
| `server/providers/hr/performance/assistant.ts:212-240` | AI 关闭时，绩效目标模板是"本人负责工序""首件检验记录完整率""带教新人" | 非制造业拿到工厂目标 | 改成可配置：按考核方案维护目标模板 |
| `server/providers/hr/recruiting/resume-text.ts:122-153,306` | 规则版简历解析只认机加工技能和叉车证、焊工证 | 其他行业简历技能识别为空 | 保留为制造业行业包：技能词典按行业或从能力项加载 |
| `server/providers/hr/recruiting/checkins.ts:56-59`；`recruiting/config.ts:16-23` | 新员工回访的话题固定为住宿、班车、带教等 | 话题分类不适用 | 话题改成可配置 |
| `server/providers/hr/talent-service.ts:105-112` | 用工类型固定为全职、兼职、实习、外包、派遣 | 缺季节工、临时工、多点执业、返聘等 | 改成可配置 |
| `server/providers/hr/custom-fields.ts:22-38` | 部门和职位不能加自定义字段 | 无法记录门店编号、床位数、成本中心 | 加入可扩展表 |

## 三、新装就带的制造业默认值和种子

这些不受演示数据开关控制，任何行业的新客户安装后都会有。

| 位置 | 内容 | 处理 |
|---|---|---|
| `database/seed-data/permission-sets.ts:605-622`（种子 202609270101） | 权限集 `prod.cncOperator`（设备开工登记） | 保留为制造业行业包：移出核心权限集，只在启用行业包时写入 |
| `database/main/seeds/202610120101_licensed_permissions.ts:44-63` | 权限集 `equip.forkliftOperator`（叉车出库登记） | 同上 |
| `database/main/seeds/202609280101_hr_learning_permissions.ts:26,42` | `page:demo.batchRecord`、`composite:demo.batch` | 同上 |
| `server/providers/hr/licensed/pack.ts:26-31` | 持证上岗的"只能由证书授予"权限集默认是 CNC 和叉车 | 默认改为空，由行业包提供 |
| `server/routes/hr/licensed.ts`、`server/routes/hr/insights.ts:96-101` | 设备开工、叉车出库的接口总是挂载 | 只在行业包启用时挂载 |
| `server/providers/hr/automation.ts:57,79` | 搜索同义词默认"CNC/数控; 操作工/操作员; 班组长/组长" | 默认改为空，制造业行业包提供 |
| `server/providers/hr/talent-review/config.ts:149-154` | 术语表默认首件检验、作业指导书、上岗证 | 默认改为空，行业包提供 |
| `server/providers/hr/performance/common.ts:100-104` | 绩效质量规则默认排除"设备故障" | 默认改为空 |
| `server/providers/hr/recruiting/config.ts:178-184` | 回访问题默认"宿舍离车间远不远""班车""带教师傅" | 改成中性默认问题 |
| `database/main/seeds/202610090101_recruiting_permissions.ts:18-19` 等 | 权限集"ERP 集成（排产计划）"；接口密钥默认名 `integration_mes` | 改成中性："业务系统集成（业务量计划）" |

另外，生产环境安装后没有任何班次、考勤规则、假期类型和薪资结构，所有行业都要从零配置。建议提供可选的**行业起步模板**（办公室、零售门店、医院、工厂），见第六节。

## 四、AI 员工提示词和示例

AI 员工的提示词决定它怎么举例、怎么追问。下面这些都应改成中性示例，行业专属内容只在启用对应行业包时追加（`withLicensedTools` 已经有追加提示词的做法）。

| 位置 | 现有的工厂内容 |
|---|---|
| `server/ai/employees/practice-coach/index.ts:10-21`；`practice-service.ts:203`；`training-automation.ts:709` | 陪练角色定为"机加工车间班组长""整车厂客户审核员"，例子 WI-MC-0231 |
| `server/ai/employees/hr-assistant/index.ts:28,40,48` | "装配车间没有负责人……苏州工厂"、夜班津贴 |
| `server/ai/employees/talent-analyst/index.ts:16-27` | 问候语"苏州工厂持 CNC 岗位上岗证……"，质量问题、设备、夜班 |
| `server/ai/employees/performance-assistant/index.ts:25-32`；`performance/assistant.ts:145-151,188,415` | 质量系统、首件检验 QI-2026-0301 |
| `server/ai/employees/learning-coach/index.ts:21` | "CNC 岗位上岗证" |
| `server/ai/employees/recruiting-assistant/index.ts:25-26`；`recruiting/assistant.ts:271-272,328-336` | "叉车证之于 CNC 岗位"、三班倒、一线 CNC 上岗证 |
| `server/ai/employees/certification-steward/index.ts:24`；`server/ai/tools/licensed-tools.ts`；`exam-tools.ts:316-330` | 工单 MO-24031、op10 粗车等（保留为行业包，只在启用时注入） |
| `server/ai/tools/profile-tools.ts:459,505,974`；`profile/analyst.ts:156-162` | 整车厂审核、机加工车间 CNC 操作工、8D 报告、"由质量部决定" |
| `server/ai/tools/payroll-tools.ts:318,322`；`payroll/assistant.ts:274` | 计件 2,400 件、夜班 12 次（可加一个非工厂例子） |
| `server/providers/hr/recruiting/assistant.ts:1083-1128` | 用工计划提示词和兜底说明把单位写死为"件" |
| `server/providers/hr/ai-entry-service.ts:182-194`；`automation-tasks.ts:603` | 默认路由描述"车间安全"、关键词"首饰""手套" |
| `server/providers/hr/exam-service.ts:2140-2150` | 题目导入模板的示例行是 CNC 首件题 |

## 五、界面措辞（所有客户都会看到的）

| 位置 | 现有措辞 | 改为 |
|---|---|---|
| `client/locales/modules/recruiting.ts:787,827,1007-1021,1304,1338-1344,1410`（及 en） | 排产计划、计划产量、本月产量、可产出、人均产能（件 / 人·班） | 业务量计划、计划业务量、产出/服务量；单位取自设置 |
| `server/locales/en-US.ts:874`；`client/locales/en-US.ts:1750` | ERP integration (production plans) | Business-system integration (demand plans) |
| `client/locales/zh-CN.ts:1185`（en 1297） | 规则名占位符"如：厂长审批" | "如：部门负责人审批" |
| `client/locales/modules/core-hr-additions.ts:658-663,1370-1375` | 一句话改流程示例"成都工厂的入职单……加一级厂长审批"、宿舍号 | 中性示例 |
| `client/locales/zh-CN.ts:2155`（en 2301） | 陪练角色示例"机加工车间班组长" | "一线主管" |
| `client/locales/zh-CN.ts:2726-2729`（en 2903） | 知识问答示例（首件检验、旋转设备、批量加工） | 中性示例，或从设置读取 |
| `client/locales/zh-CN.ts:1492` | 同义词提示"CNC/数控; 操作工/操作员" | 中性示例 |
| `client/locales/modules/profile-additions.ts:143,307,672,829` | 找人、审计范围占位符"苏州工厂持 CNC 岗位上岗证……" | 中性示例 |
| `server/locales/modules/recruiting.ts:349`；`client/locales/modules/recruiting.ts:957` | 回访话题"班车" | 随话题可配置一并处理 |
| `client/locales/modules/exam-additions.ts:338` | 外部证书提示用叉车证举例 | 中性示例 |
| `server/providers/hr/licensed/exports.ts:5,347-384`；`client/locales/modules/licensed.ts:194,291-294` | 导出"工单人员追溯"，列为工序、设备 | "持证操作追溯"，列为业务单号、步骤、资产 |
| `server/providers/hr/hr-assistant-changes.ts:78` | "飞书账号需……停用" | "{{通讯录}} 账号需……停用" |
| `server/providers/hr/recruiting/workforce.ts:341,369-371,387`；`replacement.ts:176-200,304-349` | 用工计划的成本说明、顶班理由是写在代码里的中文 | 移到语言包；没有夜班规则时不显示"夜班 N 次" |

不用改的：夜班、连续夜班（医院、物流同样有）；"非生产环境"（指运行环境）。

## 六、第二个行业还缺的机制

以医院为例："执业医师证"授予"处方开具"权限，证书过期当天收回。今天已经能做到：建一个授予 `page:clinical.prescribe` 的权限集，挂到执业医师证上，列入"只能由证书授予"，班次要求持证。还缺：

1. **证书可解锁的页面和操作登记表**：取代写死的 `PAGE_TITLES`（`licensed/index.ts:51-54`）和 `DEMO_PAGES`（`client/pages/demo/pages.ts`），让证书详情页、持证人证书墙和 AI 认证专员能显示"处方开具"并链接过去。
2. **通用的"持证操作记录"**：取代只记设备开工、叉车出库的 `demoBatchSignoffs`（字段改为操作类型、业务单号、步骤、资产编号），让"谁持哪张证签了哪一步"的追溯和导出对处方同样适用。
3. **行业包的启用和停用**：每个行业包带自己的权限集、页面、术语表、同义词、技能词典、回访话题、AI 提示词补充和示例；新装只装核心，管理员在设置里启用行业包。现有制造业内容整体移入"制造业行业包"。
4. **行业起步模板**（可与第 3 点合并）：班次、考勤规则、假期类型、薪资结构、用工计划的业务量单位（件、单、床位、客流、工时）和"按比例配置"模式（每床护士数、每店店员数）。

## 七、建议的修复顺序

1. **先修缺陷和写死的规则**（第二节）：删掉 CNC 关键词追加；审批人识别、同名部门、借调住宿风险、时薪工时、每周休息日改成通用或可配置。改动小，立即惠及所有行业。
2. **清理新装默认值**（第三节）：CNC/叉车权限集和页面、同义词、术语表、绩效排除项、回访问题不再随核心安装。已有数据库需要一个新迁移或种子来处理已写入的权限集（不能改已执行的种子）。
3. **中性化 AI 提示词和界面措辞**（第四、五节）：工作量大但风险低；用工计划的业务量单位改成设置项。
4. **做行业包机制和第二个行业**（第六节）：登记表、通用持证操作记录、行业包启停；再用一个非制造业案例（如连锁零售或医院）验证。
   - **机制已完成（2026-10-06）**：行业内容包登记表 `server/providers/hr/industry-packs/`（每个包声明页面、路径、业务操作、操作类型和权限集定义），取代了写死的 `PAGE_TITLES` 和 `DEMO_PAGES`；启停记在 personnelSettings 行 `industryPacks`，在“设置 → 持证上岗 → 行业内容包”切换（`GET/PUT /api/talent/licensed/industry-packs[/:key]`）。启用时补建缺少的权限集，不改已有的；停用不删除任何东西，只让该包的页面、登记接口（`INDUSTRY_PACK_DISABLED`）、追溯、导出和认证管家工具停止。设备开工登记、叉车出库登记已移入第一个包“制造业”（`manufacturing`）；新安装默认不启用，演示库由种子 202610230102 启用，已在用这两个权限集的老安装由 202610230101 保持启用。
   - **仍待做**：通用的持证操作记录表（今天仍是 `demoBatchSignoffs`，字段为工单/工序/设备）；术语表、同义词、技能词典、回访话题、AI 提示词补充随包启停；第二个行业包（如医院“执业医师证 → 处方开具”）。
5. **范围外**（另行决定）：钉钉、企业微信适配；非中国薪资与合规；AI 回复语言跟随界面语言。
