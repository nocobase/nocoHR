// Localized presentation model; all wire contracts remain the public native types.
export type {
  AuthorizationOptionsResponse,
  AuthorizationSubject,
  AuthorizationInspection,
  AuthorizationDecision,
  AuthorizationReason,
  ConfiguredAccess,
  LocalizedText,
} from '@nocobase/app-plugin-authorization/client';
import type { LocalizedText } from '@nocobase/app-plugin-authorization/client';
export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}
/** One data scope of a composite action, as the workspace edits it. */
export interface DataScopeOption {
  key: string;
  label: string;
  collection: string;
  collectionFields: readonly string[];
  /** `''` selects nothing: only default access and sharing apply. */
  defaultValue: string;
  /** `''` first, then the record access this scope offers. */
  options: readonly SelectOption[];
}
export interface ResourceOption extends SelectOption {
  /** The resource type grants store; never displayed. */
  type: string;
  searchText?: string;
  group?: string;
  actions?: readonly SelectOption[];
  /** Composite items only: the data scopes of each action. */
  dataScopes?: Readonly<Record<string, readonly DataScopeOption[]>>;
}
export interface ResourceGroupOption extends SelectOption {
  children?: readonly ResourceGroupOption[];
}
/** A left-side entry: its resources, grouped by `groups`. */
export interface SubsectionOption {
  value: string;
  label: string;
  /** Set when the client supplies the resources, such as `page`. */
  recordType?: string;
  /** The record type's actions, else every action its resources name. */
  actions: readonly SelectOption[];
  groups: readonly ResourceGroupOption[];
  resources: readonly ResourceOption[];
}
/** A left-side heading. */
export interface SectionOption {
  value: string;
  label: string;
  order: number;
  subsections: readonly SubsectionOption[];
}
export interface DatabaseCollectionOption {
  name: string;
  fields: readonly string[];
}
export interface RecordAccessOption extends SelectOption {
  collections?: readonly string[];
}
export interface SubjectTypeOption extends SelectOption {
  selection?:
    | {
        type: 'fixed';
        id: string;
      }
    | {
        type: 'collection';
      };
}
export interface SubjectOption {
  id: string;
  /** Plain text, or a `{ key, ns }` descriptor rendered in the viewer's language. */
  title: LocalizedText;
  description?: LocalizedText;
}
/** The workspace model an `options` response is localized into. */
export interface AuthorizationOptions {
  sections: readonly SectionOption[];
  subjectTypes: readonly SubjectTypeOption[];
  collections: readonly DatabaseCollectionOption[];
  recordAccess: readonly RecordAccessOption[];
}
