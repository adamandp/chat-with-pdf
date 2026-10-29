export const DOCUMENT_QUEUE = {
  DOCUMENTS: {
    NAME: 'documents',
    EVENTS: {
      WAITING: 'waiting',
      ACTIVE: 'active',
      PROGRESS: 'progress',
      COMPLETED: 'completed',
      FAILED: 'failed',
      DELAYED: 'delayed',
      STALLED: 'stalled',
      REMOVED: 'removed',
    },
  },
} as const;
