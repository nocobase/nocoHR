/**
 * V2-07 演示资料 (启衡精密 · 成都工厂招 10 名 CNC 操作工): 30 fictional resumes
 * as Word files — 29 for the batch import (8 with CNC experience, 3 with a
 * forklift licence, 5 plainly unrelated, two sharing one mobile number) and
 * 周迪's (2 years on CNC lathes), which he submits on the careers page. Every
 * resume states gender, age and a photo line on purpose: screening must not
 * use them. "虚构" is written only in the document properties. Mobiles and
 * emails are test values (@qiheng.test). Only the demo seed and the tests read
 * this module.
 */

export interface DemoResume {
  readonly file: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly gender: '男' | '女';
  readonly age: number;
  readonly education: string;
  readonly experiences: readonly string[];
  readonly skills: readonly string[];
  readonly certificates: readonly string[];
  readonly kind: 'cnc' | 'forklift' | 'unrelated' | 'general' | 'zhoudi';
}

const SURNAMES = ['赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫', '蒋', '沈', '韩', '杨', '朱', '秦', '尤', '许', '何', '吕', '施', '张', '孔', '曹', '严', '华', '金'];
const GIVEN = ['伟', '强', '磊', '军', '洋', '勇', '杰', '涛', '明', '超', '亮', '健', '峰', '斌', '鹏', '辉', '刚', '平', '浩', '鑫', '宇', '凯', '龙', '飞', '波', '林', '晨', '阳', '东'];

function person(i: number) {
  return `${SURNAMES[i % SURNAMES.length]}${GIVEN[(i * 7) % GIVEN.length]}${i % 3 === 0 ? '' : GIVEN[(i * 11 + 3) % GIVEN.length]}`;
}

/** The 29 import resumes. Resume 7 and resume 21 share one mobile (去重). */
export const DEMO_RESUMES: readonly DemoResume[] = Array.from({ length: 29 }, (_, n) => {
  const i = n + 1;
  const kind: DemoResume['kind'] =
    i <= 8 ? 'cnc' : i <= 11 ? 'forklift' : i <= 16 ? 'unrelated' : 'general';
  const phone = i === 21 ? '13900007007' : `139000070${String(i).padStart(2, '0')}`;
  const years = (i % 5) + 1;
  const experiences =
    kind === 'cnc'
      ? [
          `2019-2025 某机械加工厂 数控车床操作工 ${years} 年：负责数控车床与加工中心装夹、加工与首件检验`,
          '能看懂零件图纸，熟练使用游标卡尺和千分尺，适应倒班',
        ]
      : kind === 'forklift'
        ? [`2020-2025 某物流仓库 叉车司机 ${years} 年：负责仓库装卸与物料周转`]
        : kind === 'unrelated'
          ? [
              [
                `2021-2025 某餐饮公司 服务员 ${years} 年`,
                `2020-2025 某商场 导购 ${years} 年`,
                `2022-2025 某公司 行政文员 ${years} 年`,
                `2019-2025 某装修公司 设计助理 ${years} 年`,
                `2021-2025 某培训机构 课程顾问 ${years} 年`,
              ][i - 12],
            ]
          : [`2021-2025 某电子厂 装配普工 ${years} 年：负责流水线装配与包装`];
  return {
    file: `简历-${String(i).padStart(2, '0')}.docx`,
    name: person(i),
    phone,
    email: `candidate${String(i).padStart(2, '0')}@qiheng.test`,
    gender: i % 4 === 0 ? '女' : '男',
    age: 20 + (i % 15),
    education: kind === 'unrelated' && i % 2 ? '大专 某职业学院 市场营销专业 毕业' : i % 3 === 0 ? '中专 某技工学校 数控技术专业 毕业' : '高中 某中学 毕业',
    experiences,
    skills:
      kind === 'cnc'
        ? ['数控车床', '加工中心', '看图纸', '游标卡尺', '千分尺', 'FANUC 系统']
        : kind === 'forklift'
          ? ['叉车驾驶', '仓库管理']
          : kind === 'unrelated'
            ? ['沟通', 'Excel']
            : ['装配', '包装'],
    certificates: kind === 'forklift' ? ['叉车证（N1）'] : kind === 'cnc' && i % 2 ? ['数控车工（四级）'] : [],
    kind,
  };
});

/** 周迪: 2 years on CNC lathes, submits on the careers page in the demo. */
export const ZHOU_DI_RESUME: DemoResume = {
  file: '周迪-简历.docx',
  name: '周迪',
  phone: '13900007100',
  email: 'zhoudi@qiheng.test',
  gender: '男',
  age: 24,
  education: '中专 成都某技工学校 数控技术专业 毕业',
  experiences: [
    '2023-2025 成都某汽车零部件厂 数控车床操作工 2 年：负责数控车床装夹与加工、首件检验、过程自检与设备日常保养',
    '能看懂零件图纸，熟练使用卡尺与千分尺，适应三班倒',
  ],
  skills: ['数控车床', '看图纸', '卡尺', '千分尺', '首件检验', '设备保养', '三班倒'],
  certificates: ['数控车工（四级）'],
  kind: 'zhoudi',
};

/** 邹鹏: 3 years on CNC lathes; his resume arrives forwarded by a job site to the 招聘邮箱 (V2-07 招聘邮箱). */
export const ZOU_PENG_RESUME: DemoResume = {
  file: '邹鹏-简历.docx',
  name: '邹鹏',
  phone: '13900007301',
  email: 'zoupeng@mail.test',
  gender: '男',
  age: 27,
  education: '中专 德阳某技工学校 机械加工专业 毕业',
  experiences: [
    '2022-2025 德阳某阀门厂 数控车床操作工 3 年：负责数控车床编程调用、装夹与加工，首件送检与过程自检',
    '能看懂零件图纸，熟练使用卡尺、千分尺与高度尺，适应倒班',
  ],
  skills: ['数控车床', 'FANUC 系统', '看图纸', '卡尺', '千分尺', '首件检验', '倒班'],
  certificates: ['数控车工（四级）'],
  kind: 'cnc',
};

/** 另 2 名公开页投递的候选人: one answers "不能" to 三班倒. */
export const PUBLIC_APPLICANTS = [
  { name: '邱明', phone: '13900007201', email: 'qiuming@qiheng.test', shiftWork: 'no' },
  { name: '黎平', phone: '13900007202', email: 'liping@qiheng.test', shiftWork: 'yes' },
] as const;

export function resumeLines(r: DemoResume): string[] {
  return [
    `姓名：${r.name}`,
    `性别：${r.gender}`,
    `年龄：${r.age} 岁`,
    '照片：[一寸照片]',
    `手机：${r.phone}`,
    `邮箱：${r.email}`,
    '婚育状况：未婚',
    '籍贯：四川',
    '教育经历',
    r.education,
    '工作经历',
    ...r.experiences,
    '技能',
    r.skills.join('、'),
    ...(r.certificates.length ? ['证书', ...r.certificates] : []),
  ];
}

// ---------- A minimal Word writer (stored ZIP, no compression) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, file.data.length, true);
    local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, file.data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.data.length, true);
    entry.setUint32(24, file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + file.data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const escapeXml = (s: string) =>
  s.replace(/[&<>"]/gu, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** A Word document with one paragraph per line; `description` goes to the document properties. */
export function docx(lines: readonly string[], description = '个人简历'): Uint8Array {
  const encoder = new TextEncoder();
  const body = lines
    .map((l) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(l)}</w:t></w:r></w:p>`)
    .join('');
  return zip([
    {
      name: '[Content_Types].xml',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      ),
    },
    {
      name: 'word/document.xml',
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ),
    },
    {
      name: 'docProps/core.xml',
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>简历</dc:title><dc:description>${escapeXml(description)}</dc:description></cp:coreProperties>`,
      ),
    },
  ]);
}

export function resumeDocx(r: DemoResume): Uint8Array {
  return docx(resumeLines(r));
}
