# V1 第一步 · 基础与体系

> 来源：https://nocobase.feishu.cn/wiki/KLpvwdvNtiC40lknVNlcBZuEnle （2026-09-27 导出）

## 范围

本步搭出“人”和“岗位要求”两个底座：HR 能维护组织、员工和岗位能力模型，并借助体系顾问生成能力模型草稿；主管能看团队、评定能力；员工能看到自己的岗位要求和差距。

本步做：

- 组织：部门树、部门成员、部门负责人；注册 org.department 继承主体与部门负责人派生主体。
- 员工档案：增删改查、与登录用户关联、Excel 批量导入。
- 岗位体系：岗位序列、岗位；注册 org.position 主体，使员工按当前岗位获得权限。
- 能力模型：能力词典、等级描述、岗位要求、草稿确认流程。
- 能力评定：主管或 HR 手工评定员工能力等级，保留历史。
- 能力差距：员工档案内展示“岗位要求 vs 当前等级”。
- AI 员工“体系顾问”：根据 JD 或岗位说明生成能力项、等级描述和岗位要求草稿。
- 权限集 hr.admin、hr.manager、hr.employee 及其初始分配。
- 演示种子数据。

本步不做：组织同步；知识库、课程、考试、认证、证书；jobEvents、学习任务自动指派；能力雷达图、报表；审计导出。

## 数据表（9 张，均含 id 字符串主键、createdAt、updatedAt）

### departments / departmentMembers

完全按官方“组织维度”参考（references/organization.md）实现。额外要求：departments 增加 code（字符串，可空，唯一）用于 Excel 导入匹配。

### employees

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| employeeNo | 字符串 | 是 | 工号，唯一 |
| name | 字符串 | 是 | 姓名 |
| userId | 字符串 | 否 | 关联登录用户，唯一；为空表示暂无账号 |
| departmentId | 关联 departments | 是 | 主部门；有 userId 时与其主部门成员关系保持一致 |
| positionId | 关联 positions | 否 | 当前岗位 |
| managerEmployeeId | 关联 employees | 否 | 直属上级 |
| status | 枚举 | 是 | active / leave，默认 active |
| hireDate | 日期 | 否 | 入职日期 |
| positionSince | 日期 | 否 | 任现岗日期 |
| email | 字符串 | 否 | 工作邮箱 |
| mobile | 字符串 | 否 | 敏感字段，仅 hr.admin 与本人可见 |
| note | 长文本 | 否 | 仅 hr.admin 可见 |

### jobFamilies

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | 字符串 | 是 | 唯一编码，如 store |
| title | 字符串 | 是 | 名称 |
| description | 长文本 | 否 | 说明 |
| active | 布尔 | 是 | 默认 true |
| sortOrder | 整数 | 是 | 默认 0 |

### positions

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | 字符串 | 是 | 唯一编码，如 store-cashier |
| title | 字符串 | 是 | 名称 |
| jobFamilyId | 关联 jobFamilies | 是 | 所属序列 |
| grade | 字符串 | 否 | 职级 |
| responsibilities | 长文本 | 否 | 职责说明 / JD 原文 |
| active | 布尔 | 是 | 默认 true |

### competencies

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | 字符串 | 是 | 唯一编码 |
| title | 字符串 | 是 | 名称 |
| category | 枚举 | 是 | skill / quality / qualification |
| description | 长文本 | 否 | 定义 |
| maxLevel | 整数 | 是 | 1–5，默认 5；资质类通常为 1 |
| source | 枚举 | 是 | manual / ai / import |
| reviewStatus | 枚举 | 是 | draft / confirmed；手工默认 confirmed，AI 必为 draft |
| active | 布尔 | 是 | 默认 true |

### competencyLevels

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| competencyId | 关联 competencies | 是 | |
| level | 整数 | 是 | 1..maxLevel；(competencyId, level) 唯一 |
| title | 字符串 | 是 | 如“入门”“熟练” |
| behaviors | 长文本 | 是 | 行为描述 |

能力项与其等级共用一个 reviewStatus，确认时整体确认。

### positionRequirements

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| positionId | 关联 positions | 是 | |
| competencyId | 关联 competencies | 是 | (positionId, competencyId) 唯一 |
| requiredLevel | 整数 | 是 | 不超过能力项 maxLevel |
| mandatory | 布尔 | 是 | 默认 false |
| source | 枚举 | 是 | |
| reviewStatus | 枚举 | 是 | |

### employeeCompetencies

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| employeeId | 关联 employees | 是 | |
| competencyId | 关联 competencies | 是 | |
| level | 整数 | 是 | 0..maxLevel |
| source | 枚举 | 是 | assessment / import；后续增加 exam、certificate |
| evidence | 长文本 | 否 | 评定依据 |
| assessedBy | 字符串 | 是 | 服务端取当前用户 |
| assessedAt | 日期时间 | 是 | |

只新增不修改；当前等级 = assessedAt 最新一条。索引 (employeeId, competencyId, assessedAt)。

## 菜单与页面

| 菜单 | 路径 | 页面资源 | 可访问的权限集 |
| --- | --- | --- | --- |
| 人才发展 / 我的档案 | /talent/me | talent.me | hr.employee 及以上 |
| 人才发展 / 员工 | /talent/employees | talent.employees | hr.admin、hr.manager |
| 人才发展 / 岗位体系 | /talent/framework | talent.framework | hr.admin（编辑）、hr.manager 与 hr.employee（只读） |
| 人才发展 / 能力词典 | /talent/competencies | talent.competencies | hr.admin |
| 设置 / 组织管理 | 按官方组织维度设置页 | 设置项 | hr.admin |

- 我的档案：基本信息卡；岗位要求与差距表（只显示已确认要求，差距>0 突出，必备在前，点击展开等级描述）；评定记录倒序；未关联时显示“尚未关联员工档案，请联系 HR”。
- 员工：列表（工号、姓名、部门、岗位、状态、待补能力数；搜索姓名/工号；筛选部门含下级、岗位、状态；主管只看本部门及下级）。hr.admin：新建、编辑、标记离职、关联登录用户、Excel 导入（模板下载；列=工号、姓名、部门编码、岗位编码、上级工号、入职日期、邮箱、手机；预览逐行报错；确认后单事务按工号新增或更新）。详情子路由：基本信息 Tab、能力 Tab（差距表 + 每行“评定”弹窗 + 评定历史；可评定岗位要求以外的能力项）。
- 岗位体系：左侧序列→岗位两级列表可搜索；hr.admin 可增改停用。右侧岗位信息、职责说明、要求表。hr.admin：添加/编辑/移除要求；“用体系顾问生成”；草稿行标记，逐条或批量确认/丢弃；确认要求时若能力项仍为草稿提示“将一并确认能力项 X”。manager/employee 只读且看不到草稿。
- 能力词典：按类别分组；列=编码、名称、最高等级、来源、状态、被引用岗位数；筛选“只看草稿”。详情抽屉：等级行内编辑、确认/丢弃、停用。减小 maxLevel 时若有冲突拒绝并列出。
- 设置 / 组织管理：按官方组织维度设置页规范。

## 服务端联动（无工作流，写在服务代码中）

| 触发 | 处理 |
| --- | --- |
| 保存有 userId 的员工，或修改其 departmentId | 同一事务内把该用户的主部门成员关系指向该部门 |
| 修改员工 positionId | 更新 positionSince；刷新该用户会话，使 org.position 主体变化立即生效 |
| 员工标记离职 | 停用其部门成员关系，不再属于任何岗位主体；不删除档案和评定记录 |
| 确认岗位要求 | 若引用的能力项是草稿，同一事务内一并确认 |
| 停用岗位或能力项 | 不影响历史记录；停用岗位上仍有在职员工时提示数量，但允许操作 |

## AI 员工：体系顾问 frameworkAdvisor

入口：岗位体系页“用体系顾问生成”，聊天面板，当前岗位 id 作为上下文。仅 hr.admin。

| 工具 | 类型 | 输入 | 行为 |
| --- | --- | --- | --- |
| getPositionContext | 读 | positionId | 岗位名称、序列、职级、职责说明、现有要求 |
| searchCompetencies | 读 | 关键词、类别（可选） | 匹配的已有能力项（含状态） |
| createCompetencyDrafts | 写 | 能力项数组 code、title、category、description、maxLevel、levels | 创建 source=ai、draft 的能力项及等级；code 冲突返回错误 |
| createRequirementDrafts | 写 | positionId、要求数组 competencyId、requiredLevel、mandatory | 创建草稿要求；已存在的已确认要求不覆盖，返回跳过清单 |

写工具需要用户批准。提示词：先 getPositionContext（职责为空先要 JD）；每项先 searchCompetencies 查重；6–12 项，资质类 maxLevel=1；等级写可观察行为；写入前表格列方案；写入后提醒需确认。前提：config.yml 已配置 ai.llmServices（人工提供）。

## 权限配置

| 资源 | 操作 | 说明 |
| --- | --- | --- |
| talent.employee | view、create、update、import、linkUser、markLeave | 员工档案 |
| talent.assessment | view、create | 范围沿用所属员工 |
| talent.framework | view、manage、confirm | view 不含草稿 |
| talent.competency | view、manage、confirm | view 不含草稿 |
| talent.frameworkAdvisor | use | |

数据范围：all；managedDepartments（负责部门及下级）；self。

| 权限集 | 页面 | 业务操作与范围 | 敏感字段 |
| --- | --- | --- | --- |
| hr.admin | 全部 5 个 | 全部操作，范围 all | mobile、note 可读写 |
| hr.manager | 员工、岗位体系、我的档案 | talent.employee.view、talent.assessment.view/create 范围 managedDepartments；talent.framework.view、talent.competency.view | 不可见 |
| hr.employee | 我的档案、岗位体系 | talent.employee.view、talent.assessment.view 范围 self；framework.view、competency.view | 仅本人 mobile 可读 |

初始分配：hr.admin → 人力资源部；hr.manager → 部门负责人主体；hr.employee → 根部门。评定时服务端校验：不允许评定自己；主管只能评定范围内的员工。

## 测试数据（仅开发/演示环境）

```
样例便利（根）
├─ 人力资源部
└─ 运营部
   ├─ 华东区
   │  ├─ 南京路店
   │  └─ 淮海路店
   └─ 华南区
      └─ 天河店
```

| 账号 | 员工 | 部门 | 岗位 | 用途 |
| --- | --- | --- | --- | --- |
| hr01 | 林晓 | 人力资源部 | HR 专员 | 测试 hr.admin |
| mgr_east | 周宏 | 华东区（负责人） | 区域经理 | 下级部门范围 |
| mgr_njl | 陈静 | 南京路店（负责人） | 店长 | 本部门范围 |
| emp_njl_1 | 王磊 | 南京路店 | 收银员 | 有差距的员工 |
| emp_njl_2 | 李敏 | 南京路店 | 收银员 | 第二名同岗员工 |
| emp_th_1 | 赵阳 | 天河店 | 收银员 | 范围外员工 |
| 无账号 | 孙丽 | 淮海路店 | 收银员 | 暂无账号 |

序列 store（store-cashier、store-manager、store-area-manager）；office（office-hr）。收银员职责：负责收银结算、会员办理、退换货受理、热食区食品安全、开闭店现金盘点，须持健康证上岗。店长不设要求。

| 能力项 | 类别 | 最高等级 | 收银员要求 | 必备 |
| --- | --- | --- | --- | --- |
| 收银操作 | skill | 5 | 3 | 是 |
| 食品安全知识 | skill | 5 | 2 | 是 |
| 客户服务 | quality | 5 | 2 | 否 |
| 健康证 | qualification | 1 | 1 | 是 |
| 商品陈列 | skill | 5 | — | — |
| 团队管理 | quality | 5 | — | — |

评定：王磊 收银操作 3、客户服务 2（mgr_njl 评定）；李敏 收银操作先 1，一个月后 3。

## 验收用例

组织与员工：停用华南区后天河店视为停用，恢复后子部门未改；上级设为自身下级被拒；10 行 Excel 导入 2 行错误被准确指出，修正后按工号更新；王磊调淮海路店后成员关系同步、mgr_njl 看不到；李敏离职后档案评定仍在、不再属于收银员主体；孙丽可创建评定，关联用户后能看到“我的档案”。

能力模型与差距：王磊显示 4 项要求，食品安全（差 2）健康证（差 1）突出、必备在前；李敏当前等级 3、两条历史；收银操作 maxLevel 改 2 被拒并列冲突；重复添加要求被拒。

体系顾问：店长岗位先读岗位、表格方案、复用已有项；写入后 source=ai/draft，mgr_njl 看不到；确认引用草稿能力项的要求一并确认，丢弃的不再出现；mgr_njl 无入口、调用写工具被拒。

权限与数据范围：mgr_east 看到南京路店和淮海路店、看不到天河店，直接请求赵阳返回无权限；mgr_njl 能评定王磊、不能评定赵阳和自己；emp_njl_1 只能打开我的档案和岗位体系，访问员工接口被拒；mgr_east 看不到 mobile、note；授权中移除 hr.manager 后 mgr_njl 立即失去访问，恢复后重新获得。

通用：英文无未翻译中文；我的档案手机宽度可用；类型检查、lint、测试通过；权限矩阵有服务端测试。
