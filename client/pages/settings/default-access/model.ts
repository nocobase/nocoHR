import type { AuthorizationOptionsResponse } from '@nocobase/app-plugin-authorization/client';
import type { RecordSelection } from '@nocobase/authorization/core';

export type { AuthorizationOptionsResponse, RecordSelection };

export interface DefaultAccessRule {
  readonly key: string;
  readonly resource: { readonly type: string; readonly id: string };
  readonly actions: readonly {
    readonly action: string;
    readonly scopeKey?: string;
    readonly selection: RecordSelection;
  }[];
}

export interface DefaultAccessRecordOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface DefaultAccessOptions {
  readonly options: AuthorizationOptionsResponse;
  readonly rules: readonly DefaultAccessRule[];
}
