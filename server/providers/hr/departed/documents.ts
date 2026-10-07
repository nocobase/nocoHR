/**
 * 已离职员工的文件 (V1-02 V2 增补): the documents a departed employee receives
 * by link — the separation certificate (from the template an HR administrator
 * confirmed), an employment certificate, an income certificate and the last
 * payslip — as text-only PDFs. No ID number is ever printed; amounts appear
 * only in the payslip and the income certificate, which only payroll sends.
 */
import { renderPdf, type PdfBlock } from '../profile/pdf.js';

export const DOCUMENT_KINDS = [
  'separationCertificate',
  'employmentCertificate',
  'incomeCertificate',
  'payslip',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_TITLES: Record<DocumentKind, string> = {
  separationCertificate: '离职证明',
  employmentCertificate: '工作经历证明',
  incomeCertificate: '收入证明',
  payslip: '工资条',
};

/** The separation certificate an HR administrator starts from and confirms once. */
export const DEFAULT_SEPARATION_TEMPLATE = [
  '兹证明 {{name}}（工号 {{employeeNo}}）于 {{hireDate}} 入职我公司，任 {{department}} {{position}}，',
  '于 {{leaveDate}} 与我公司解除劳动关系，离职手续已办理完毕。',
  '',
  '特此证明。',
].join('\n');

export interface PersonFacts {
  readonly company: string;
  readonly name: string;
  readonly employeeNo: string;
  readonly department: string;
  readonly position: string;
  readonly hireDate: string;
  readonly leaveDate: string;
  readonly today: string;
}

export function fill(template: string, facts: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/gu, (whole, key: string) =>
    key in facts ? facts[key] : whole,
  );
}

/** The closing line: the company and the date, or the date alone where `talent.companyName` is unset (outside production). */
function signOff(
  facts: { readonly company: string; readonly today: string },
  separator: string,
): string {
  return [facts.company, facts.today].filter(Boolean).join(separator);
}

function certificate(
  title: string,
  body: string,
  facts: PersonFacts,
): Uint8Array {
  const blocks: PdfBlock[] = [
    { kind: 'title', text: title },
    { kind: 'space' },
    { kind: 'text', text: body },
    { kind: 'space' },
    { kind: 'text', text: signOff(facts, '\n') },
  ];
  return renderPdf(blocks, { title, footer: facts.company });
}

export function separationCertificate(
  template: string,
  facts: PersonFacts,
): Uint8Array {
  return certificate(
    DOCUMENT_TITLES.separationCertificate,
    fill(template, { ...facts }),
    facts,
  );
}

export function employmentCertificate(facts: PersonFacts): Uint8Array {
  const until = facts.leaveDate || '今';
  return certificate(
    DOCUMENT_TITLES.employmentCertificate,
    `兹证明 ${facts.name}（工号 ${facts.employeeNo}）自 ${facts.hireDate} 至 ${until} 在我公司工作，任 ${facts.department} ${facts.position}。\n\n特此证明。`,
    facts,
  );
}

export interface IncomeMonth {
  readonly month: string;
  readonly gross: number;
  readonly net: number;
}

export function incomeCertificate(
  facts: PersonFacts,
  months: readonly IncomeMonth[],
): Uint8Array {
  const total = months.reduce((s, m) => s + m.gross, 0);
  const average = months.length ? total / months.length : 0;
  const money = (n: number) => n.toFixed(2);
  const blocks: PdfBlock[] = [
    { kind: 'title', text: DOCUMENT_TITLES.incomeCertificate },
    { kind: 'space' },
    {
      kind: 'text',
      text: `兹证明 ${facts.name}（工号 ${facts.employeeNo}）在我公司工作期间，${months.length} 个月的税前收入如下，月平均税前收入 ${money(average)} 元。`,
    },
    { kind: 'space' },
    {
      kind: 'table',
      rows: [
        ['月份', '税前收入（元）', '实发（元）'],
        ...months.map((m) => [m.month, money(m.gross), money(m.net)]),
      ],
    },
    { kind: 'space' },
    { kind: 'text', text: signOff(facts, '\n') },
  ];
  return renderPdf(blocks, {
    title: DOCUMENT_TITLES.incomeCertificate,
    footer: facts.company,
  });
}

export interface PayslipFacts {
  readonly month: string;
  readonly lines: readonly { title: string; amount: number | null }[];
  readonly gross: number | null;
  readonly net: number | null;
}

export function payslip(facts: PersonFacts, slip: PayslipFacts): Uint8Array {
  const money = (n: number | null) => (n == null ? '—' : n.toFixed(2));
  const blocks: PdfBlock[] = [
    { kind: 'title', text: `${slip.month} ${DOCUMENT_TITLES.payslip}` },
    { kind: 'text', text: `${facts.name}（工号 ${facts.employeeNo}）` },
    { kind: 'space' },
    {
      kind: 'table',
      rows: [
        ['项目', '金额（元）'],
        ...slip.lines
          .filter((l) => l.amount != null)
          .map((l) => [l.title, money(l.amount)]),
        ['应发合计', money(slip.gross)],
        ['实发', money(slip.net)],
      ],
    },
    { kind: 'space' },
    { kind: 'muted', text: signOff(facts, ' · ') },
  ];
  return renderPdf(blocks, {
    title: `${slip.month} ${DOCUMENT_TITLES.payslip}`,
    footer: facts.company,
  });
}
