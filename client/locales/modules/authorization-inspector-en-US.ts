// Retained inspector copy from nocobase/nocobase3@6f38530; only consumed groups are kept.
export default {
  common: {
    resource: 'Resource',
    retry: 'Retry',
  },
  subjects: {
    previous: 'Previous',
    next: 'Next',
  },
  inspector: {
    summary: {
      all: 'This operation is allowed.',
      scoped:
        'This operation is allowed only within the applicable record and field limits.',
      none: 'This operation is not allowed. Granting records alone does not grant the operation.',
      error:
        'The check could not be completed. This is not a permission denial.',
      context: 'Select a specific user to evaluate this scope.',
    },
    dataAccess: 'Which data is accessible',
    subjectHint: '“Me” refers to the person being inspected.',
    scopeAndFields: 'View effective conditions and fields',
    technicalHint:
      'Raw authorization result for troubleshooting, including underlying page and table checks.',
    selectedRecords: '{{count}} selected records',
    databaseActions: {
      read: 'Read',
      create: 'Create',
      update: 'Update',
      delete: 'Delete',
    },
    subjectType: 'Subject type',
    subject: 'Subject',
    selectSubject: 'Select a subject',
    searchSubjects: 'Search subjects',
    inheritsFrom: 'Inherits from:',
    grantedVia: 'via {{label}}',
    grantedDirectly: 'assigned directly',
    inheritedSubject: '{{name}} ({{type}})',
    listSeparator: ', ',
    noRegisteredResources: 'No resources are registered for this type yet.',
    status: {
      context: 'User context required',
      all: 'Allowed',
      scoped: 'Allowed with limits',
      none: 'Not allowed',
      error: 'Inspection failed',
    },
    reasonCodes: {
      NO_MATCHING_GRANT: 'Nothing grants this operation',
      RESOURCE_ACTION_NOT_SUPPORTED:
        'This resource does not offer this operation',
      USER_CONTEXT_REQUIRED:
        'This scope depends on a specific user and cannot be resolved from this subject alone.',
      GRANT_MATCHED: 'This operation is granted',
      SELECTION_EXPANDED: 'Expands accessible records',
      SELECTION_RESTRICTED: 'Restricts accessible records',
      NO_OBJECT_PERMISSION: 'This operation has not been granted',
      NO_RECORD_ACCESS: 'No accessible record scope',
      EMPTY_RECORD_ACCESS: 'The record scope matches no records',
      UNRESTRICTED_ACCESS: 'Unrestricted access',
    },
    inputFields: 'Writable fields',
    outputFields: 'Returned fields',
    allFields: 'All fields',
    refresh: 'Refresh',
    failed: 'Inspection failed',
    noResources: 'No matching resources',
    recordScope: 'Effective record scope',
    fields: 'Allowed fields',
    fieldSearch: 'Search fields',
    technicalDetails: 'Technical details',
    allConditions: 'Match all conditions',
    anyCondition: 'Match any condition',
    page: {
      title: 'Permission Inspector',
      description:
        'View access granted to an authorization subject and inspect the reasons.',
    },
    person: 'Person',
    selectPerson: 'Select a person',
    searchPeople: 'Search people',
    searchPeoplePlaceholder: 'Search name, username, or email',
    action: 'Action',
    selectAction: 'Select an action',
    inspect: 'Inspect',
    inspecting: 'Inspecting…',
    empty: 'Select an authorization subject to view its resource permissions.',
    decision: 'Decision',
    effects: {
      permit: 'Allowed',
      deny: 'Denied',
      conditional: 'Allowed with conditions',
    },
    reasons: 'Reasons',
    noReasons: 'The decision carries no reasons.',
    reasonFrom: 'From {{plugin}}',
    reasonFromCore: 'From the authorization core',
    conditions: 'Conditions',
    conditionsHint:
      'The decision holds only for what these conditions select, shown as the core returned them.',
  },
  permissionWorkspace: {
    configured: 'Configured in this set',
    configuredOnly: 'Only configured resources',
    development: {
      pages:
        'No pages requiring authorization have been defined. Ask AI to add page access permissions for your business pages, then configure them here.',
      business:
        'No business permissions have been defined. Ask AI to design operations, fields and record scopes for your business, then configure them here.',
    },
  },
  permissionSets: {
    picker: {
      searchResources: 'Search resources',
      noResources: 'No resources match your search.',
    },
  },
  editors: {
    actions: 'Actions',
    resourceGroup: 'Resource group',
  },
  labels: {
    allRecords: 'All records',
    defaultAndSharing: 'Use default data scope',
  },
  filterOperators: {
    $includes: 'Contains',
    $notIncludes: 'Does not contain',
    $startsWith: 'Starts with',
    $endsWith: 'Ends with',
    $empty: 'Is empty',
    $notEmpty: 'Is not empty',
    $isTruly: 'Is true',
    $isFalsy: 'Is false',
    $eq: 'Equals',
    $ne: 'Not equal',
    $in: 'In',
    $notIn: 'Not in',
    $gt: 'Greater than',
    $gte: 'At least',
    $lt: 'Less than',
    $lte: 'At most',
  },
  errors: {
    requestFailed: 'Authorization request failed.',
    forbidden: 'You do not have permission to inspect authorization.',
    sessionEnded: 'Your session has ended. Sign in again.',
  },
  marks: {
    labels: {
      all: 'Full access',
      scoped: 'Limited access',
      none: 'No access',
      bypass: 'Unrestricted',
    },
    descriptions: {
      all: 'Full access',
      scoped: 'Limited access',
      none: 'No access',
      bypass: 'Unrestricted: grants are not consulted',
    },
  },
  filters: {
    clearSearch: 'Clear {{label}}',
  },
};
