/**
 * 简历文本 (V2-07 parseResume): what may reach the model and how a resume is
 * read without one.
 *
 * - Only text is extracted (PDF, Word, plain text); images and photos are
 *   never sent. An image-only resume is not parsed by AI: the recruiter fills
 *   in the profile by hand.
 * - Before the text goes anywhere, lines about protected characteristics
 *   (性别、年龄、出生日期、婚育、民族、籍贯、宗教、政治面貌、照片 and the like)
 *   are removed, and contact data and ID numbers are masked.
 * - The parsed profile holds education, experience, skills and certificates
 *   only — never those characteristics.
 * - `ruleParse` reads the same four parts by rule when no model is available.
 */
import { documentKind, extractDocumentText } from '../document-text.js';
import type { Requirement, ScreeningSuggestion } from './common.js';

export const RESUME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
] as const;

/** Protected characteristics: a line mentioning one is dropped before any model sees the text. */
export const PROTECTED_LINE =
  /(性别|男\s*[/|]\s*女|年龄|\d+\s*岁|出生|生日|生辰|婚姻|婚育|已婚|未婚|婚否|生育|子女|民族|籍贯|户籍|户口|宗教|信仰|政治面貌|党员|团员|照片|相片|头像|身高|体重|血型|健康状况|属相|gender|\bsex\b|\bage\b|birth|marital|married|religio|ethnic|nationality|photo|height|weight)/iu;

const PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/gu;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu;
const ID_NUMBER = /(?<!\d)\d{17}[\dXx](?!\d)/gu;

export interface ParsedProfile {
  education: {
    level: EducationLevel;
    school: string | null;
    major: string | null;
  }[];
  experiences: { summary: string; years: number | null; keywords: string[] }[];
  skills: string[];
  certificates: string[];
}

export type EducationLevel =
  | 'middleSchool'
  | 'highSchool'
  | 'vocational'
  | 'associate'
  | 'bachelor'
  | 'master'
  | 'doctor'
  | 'unknown';

const LEVEL_ORDER: EducationLevel[] = [
  'unknown',
  'middleSchool',
  'highSchool',
  'vocational',
  'associate',
  'bachelor',
  'master',
  'doctor',
];

/** Reads a resume file's text; `null` when the file is only an image (or has no text). */
export async function extractResumeText(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<string | null> {
  if (mimeType.startsWith('image/')) return null;
  const kind = documentKind(filename, mimeType);
  if (!kind) return null;
  try {
    return await extractDocumentText(bytes, kind);
  } catch {
    return null;
  }
}

/** The identity a resume states, for an import: name, mobile and email. Never sent to a model. */
export function readIdentity(text: string): {
  name: string | null;
  phone: string | null;
  email: string | null;
} {
  const name =
    /姓\s*名\s*[:：]\s*([一-龥A-Za-z·]{2,20})/u.exec(text)?.[1] ?? null;
  const phone = text.match(PHONE)?.[0] ?? null;
  const email = text.match(EMAIL)?.[0] ?? null;
  return { name, phone, email };
}

/** The text a model may read: protected lines, the name line and contact data removed. */
export function sanitizeResumeText(text: string): string {
  return text
    .split('\n')
    .filter((line) => !PROTECTED_LINE.test(line))
    .filter((line) => !/姓\s*名\s*[:：]/u.test(line))
    .map((line) =>
      line
        .replace(ID_NUMBER, '[证件号已隐去]')
        .replace(PHONE, '[手机号已隐去]')
        .replace(EMAIL, '[邮箱已隐去]'),
    )
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, 12_000);
}

const EDUCATION_WORDS: [RegExp, EducationLevel][] = [
  [/博士/u, 'doctor'],
  [/硕士|研究生/u, 'master'],
  [/本科|学士/u, 'bachelor'],
  [/大专|专科|高职/u, 'associate'],
  [/中专|技校|职高|中职|技工学校|职业技术学校/u, 'vocational'],
  [/高中/u, 'highSchool'],
  [/初中/u, 'middleSchool'],
];

const SKILL_WORDS = [
  '数控车床',
  '数控铣床',
  '加工中心',
  '数控',
  'CNC',
  '车床',
  '铣床',
  '卡尺',
  '千分尺',
  '游标卡尺',
  '图纸',
  '识图',
  '看图',
  'FANUC',
  '发那科',
  '西门子',
  '编程',
  '首件检验',
  '设备保养',
  '质量记录',
  '三班倒',
  '倒班',
  '夜班',
  '叉车',
  '焊接',
  '装配',
  'Excel',
  '驾驶',
];

const CERT_LINE =
  /(证书|证[）)]?$|资格证|操作证|上岗证|等级证|叉车证|电工证|焊工证|车工|铣工)/u;

export function levelOf(text: string): EducationLevel {
  for (const [pattern, level] of EDUCATION_WORDS)
    if (pattern.test(text)) return level;
  return 'unknown';
}

export function levelRank(level: EducationLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

/** A rule reading of the four parts, with a confidence per part. */
export function ruleParse(text: string): {
  profile: ParsedProfile;
  confidence: Record<keyof ParsedProfile, number>;
} {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const education: ParsedProfile['education'] = [];
  const experiences: ParsedProfile['experiences'] = [];
  const skills = new Set<string>();
  const certificates = new Set<string>();
  let section: 'education' | 'experience' | 'skills' | 'certificates' | null =
    null;
  for (const line of lines) {
    if (/^#*\s*(教育|学历)/u.test(line)) {
      section = 'education';
      continue;
    }
    if (/^#*\s*(工作|经历|经验|实习)/u.test(line)) {
      section = 'experience';
      continue;
    }
    if (/^#*\s*(技能|专长|能力)/u.test(line)) {
      section = 'skills';
      continue;
    }
    if (/^#*\s*(证书|资格|资质)/u.test(line)) {
      section = 'certificates';
      continue;
    }
    for (const word of SKILL_WORDS)
      if (line.toLowerCase().includes(word.toLowerCase())) skills.add(word);
    const level = levelOf(line);
    if (
      (section === 'education' || /学校|学院|大学|毕业/u.test(line)) &&
      level !== 'unknown'
    )
      education.push({
        level,
        school:
          /([一-龥]{2,20}(?:学校|学院|大学|技校))/u.exec(line)?.[1] ?? null,
        major: /专业\s*[:：]?\s*([一-龥A-Za-z]{2,20})/u.exec(line)?.[1] ?? null,
      });
    if (section === 'certificates' || CERT_LINE.test(line)) {
      const cleaned = line.replace(/^[-•*\d.、\s]+/u, '').slice(0, 60);
      if (cleaned && section === 'certificates') certificates.add(cleaned);
      else if (/证/u.test(cleaned) && cleaned.length <= 30)
        certificates.add(cleaned);
    }
    if (section === 'experience' || /经验|任职|就职|工作\s*\d/u.test(line)) {
      const years = /(\d+(?:\.\d+)?)\s*年/u.exec(line)?.[1] ?? null;
      const keywords = SKILL_WORDS.filter((w) =>
        line.toLowerCase().includes(w.toLowerCase()),
      );
      if (years || keywords.length)
        experiences.push({
          summary: line.replace(PHONE, '').slice(0, 200),
          years: years ? Number(years) : null,
          keywords,
        });
    }
  }
  return {
    profile: {
      education: education.slice(0, 5),
      experiences: experiences.slice(0, 10),
      skills: [...skills],
      certificates: [...certificates].slice(0, 10),
    },
    confidence: {
      education: education.length ? 0.7 : 0.2,
      experiences: experiences.length ? 0.6 : 0.2,
      skills: skills.size ? 0.6 : 0.2,
      certificates: certificates.size ? 0.7 : 0.3,
    },
  };
}

/** Keeps only the four parts; anything else a model returned is dropped. */
export function cleanProfile(value: unknown): ParsedProfile {
  const v = (value && typeof value === 'object' ? value : {}) as Record<
    string,
    unknown
  >;
  const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  return {
    education: arr(v.education)
      .slice(0, 5)
      .map((e) => {
        const r = (e && typeof e === 'object' ? e : {}) as Record<
          string,
          unknown
        >;
        const level = typeof r.level === 'string' ? r.level : '';
        return {
          level: (LEVEL_ORDER as string[]).includes(level)
            ? (level as EducationLevel)
            : levelOf(
                `${level}${typeof r.school === 'string' ? r.school : ''}`,
              ),
          school: typeof r.school === 'string' ? r.school.slice(0, 60) : null,
          major: typeof r.major === 'string' ? r.major.slice(0, 60) : null,
        };
      }),
    experiences: arr(v.experiences)
      .slice(0, 10)
      .map((e) => {
        const r = (e && typeof e === 'object' ? e : {}) as Record<
          string,
          unknown
        >;
        const summary = (typeof r.summary === 'string' ? r.summary : '').slice(
          0,
          200,
        );
        return {
          summary,
          years:
            typeof r.years === 'number' && Number.isFinite(r.years)
              ? r.years
              : null,
          keywords: arr(r.keywords)
            .map((k) => String(k).slice(0, 30))
            .slice(0, 10),
        };
      })
      .filter((e) => e.summary && !PROTECTED_LINE.test(e.summary)),
    skills: arr(v.skills)
      .map((s) => String(s).slice(0, 40))
      .filter((s) => s && !PROTECTED_LINE.test(s))
      .slice(0, 30),
    certificates: arr(v.certificates)
      .map((s) => String(s).slice(0, 60))
      .filter((s) => s && !PROTECTED_LINE.test(s))
      .slice(0, 10),
  };
}

const DOMAIN = ['数控', 'CNC', '加工中心', '机床', '车床', '铣床'];

function mentions(haystack: string, words: readonly string[]) {
  const lower = haystack.toLowerCase();
  return words.filter((w) => lower.includes(w.toLowerCase()));
}

/**
 * 初筛（规则）: each requirement against the profile and the knockout
 * answers — met, missing, or to verify in the interview. The level is high
 * when every must-have is met, low when a must-have is clearly missing,
 * medium otherwise. Never a rejection advice.
 */
export function ruleScreen(
  requirements: readonly Requirement[],
  profile: ParsedProfile,
  knockout: readonly {
    requirementKey: string;
    meetsExpected: boolean | null;
    answer: string;
  }[],
): ScreeningSuggestion {
  const met: string[] = [];
  const missing: string[] = [];
  const toVerify: string[] = [];
  const reasons: { key: string; text: string }[] = [];
  const experienceText = profile.experiences
    .map((e) => `${e.summary} ${e.keywords.join(' ')}`)
    .join('\n');
  const skillText = `${profile.skills.join(' ')}\n${experienceText}`;
  for (const r of requirements) {
    const answer = knockout.find((k) => k.requirementKey === r.key);
    if (r.type === 'education') {
      const required = levelOf(r.text);
      const best = profile.education.reduce(
        (acc, e) => Math.max(acc, levelRank(e.level)),
        0,
      );
      if (!profile.education.length) {
        toVerify.push(r.key);
        reasons.push({ key: r.key, text: '简历中未写明学历，面试时核实' });
      } else if (required === 'unknown' || best >= levelRank(required)) {
        met.push(r.key);
        reasons.push({ key: r.key, text: '简历中的学历满足要求' });
      } else {
        missing.push(r.key);
        reasons.push({ key: r.key, text: '简历中的最高学历低于要求' });
      }
      continue;
    }
    if (r.type === 'experience') {
      const need = Number(/(\d+(?:\.\d+)?)\s*年/u.exec(r.text)?.[1] ?? 0);
      const domain = mentions(r.text, DOMAIN).length ? DOMAIN : [];
      const relevant = profile.experiences.filter(
        (e) =>
          !domain.length ||
          mentions(`${e.summary} ${e.keywords.join(' ')}`, domain).length,
      );
      const years = relevant.reduce((sum, e) => sum + (e.years ?? 0), 0);
      if (relevant.length && (years >= need || (!need && relevant.length))) {
        met.push(r.key);
        reasons.push({
          key: r.key,
          text: `简历中有 ${years || '相关'}${years ? ' 年' : ''}相关经历`,
        });
      } else if (relevant.length) {
        toVerify.push(r.key);
        reasons.push({
          key: r.key,
          text: '有相关经历但年限不明确，面试时核实',
        });
      } else {
        missing.push(r.key);
        reasons.push({ key: r.key, text: '简历中没有相关工作经历' });
      }
      continue;
    }
    if (r.type === 'certificate') {
      const words = r.text
        .replace(/(持有|具备|须|需|有效|证书|资格)/gu, ' ')
        .split(/[\s、，,（）()]+/u)
        .filter((w) => w.length >= 2);
      const has = profile.certificates.some(
        (c) => mentions(c, words).length > 0,
      );
      if (has) {
        met.push(r.key);
        reasons.push({
          key: r.key,
          text: '简历中列出了对应证书，入职前查验原件',
        });
      } else {
        toVerify.push(r.key);
        reasons.push({
          key: r.key,
          text: profile.certificates.length
            ? '简历中的证书与该要求无关，面试时核实'
            : '简历中未列出该证书，面试时核实',
        });
      }
      continue;
    }
    // skill / other: the knockout answer decides first, then the words of the requirement.
    if (answer && answer.meetsExpected !== null) {
      if (answer.meetsExpected) {
        met.push(r.key);
        reasons.push({ key: r.key, text: `门槛问题回答“${answer.answer}”` });
      } else {
        missing.push(r.key);
        reasons.push({
          key: r.key,
          text: `门槛问题回答“${answer.answer}”，与要求不符，由招聘负责人决定`,
        });
      }
      continue;
    }
    const words = mentions(r.text, SKILL_WORDS);
    const hits = words.length ? mentions(skillText, words) : [];
    if (words.length && hits.length >= Math.min(2, words.length)) {
      met.push(r.key);
      reasons.push({ key: r.key, text: `简历中提到：${hits.join('、')}` });
    } else if (hits.length) {
      toVerify.push(r.key);
      reasons.push({
        key: r.key,
        text: `简历中提到${hits.join('、')}，其余面试时核实`,
      });
    } else {
      toVerify.push(r.key);
      reasons.push({ key: r.key, text: '简历中没有直接体现，面试时核实' });
    }
  }
  const must = requirements.filter((r) => r.mustHave).map((r) => r.key);
  const mustMissing = must.filter((k) => missing.includes(k));
  const mustMet = must.filter((k) => met.includes(k));
  const matchLevel =
    mustMissing.length > 0 || met.length === 0
      ? 'low'
      : mustMet.length === must.length &&
          requirements
            .filter((r) => !r.mustHave)
            .every((r) => !missing.includes(r.key))
        ? 'high'
        : 'medium';
  return { matchLevel, met, missing, toVerify, reasons, by: 'rule' };
}
