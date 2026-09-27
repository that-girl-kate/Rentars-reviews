/**
 * Content Safety Policy — versioned taxonomy for review/report enforcement.
 *
 * VERSION BUMP RULE:
 *   Increment CURRENT_SAFETY_POLICY_VERSION when reason codes, enforcement
 *   actions, appeal windows, or retention rules change. Historical moderation
 *   decisions keep the policy_version / policy_code stamped at decision time
 *   and are never rewritten when this module changes.
 */

export const CURRENT_SAFETY_POLICY_VERSION = '2026-09-27.1';
export const SAFETY_POLICY_EFFECTIVE_DATE = '2026-09-27';

/** Appeal window after a visibility-changing decision (days). */
export const APPEAL_WINDOW_DAYS = 14;

/** Retention for moderated content snapshots (days). */
export const MODERATION_RETENTION_DAYS = 730;

/** Host response edit window after first publish (hours). */
export const HOST_RESPONSE_EDIT_WINDOW_HOURS = 24;

export const SAFETY_REASON_CODES = [
  'harassment',
  'discrimination',
  'fraud',
  'unsafe_property',
  'privacy_violation',
  'retaliatory_review',
  'spam',
  'inappropriate',
  'misleading',
  'other',
] as const;

export type SafetyReasonCode = (typeof SAFETY_REASON_CODES)[number];

export type EnforcementAction =
  | 'none'
  | 'flag_for_review'
  | 'hide_content'
  | 'reject_content'
  | 'escalate'
  | 'notify_parties';

export interface SafetyReasonPolicy {
  code: SafetyReasonCode;
  label: string;
  description: string;
  /** Default action when a report with this reason is upheld. */
  enforcementAction: EnforcementAction;
  /** User-facing status copy (never exposes moderator notes). */
  publicStatusCopy: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  appealable: boolean;
  retentionDays: number;
  /** Whether this reason applies to review reports. */
  appliesToReviews: boolean;
  /** Whether this reason applies to host responses. */
  appliesToHostResponses: boolean;
  /** Whether this reason applies to property reports. */
  appliesToProperties: boolean;
}

/**
 * Canonical reason → enforcement map. UI copy, API validation, and moderator
 * tools must all import from here so the taxonomy stays aligned.
 */
export const SAFETY_REASON_POLICIES: Record<SafetyReasonCode, SafetyReasonPolicy> = {
  harassment: {
    code: 'harassment',
    label: 'Harassment',
    description: 'Threats, intimidation, or abusive language directed at a person.',
    enforcementAction: 'hide_content',
    publicStatusCopy: 'This review was hidden for violating our harassment policy.',
    severity: 'high',
    appealable: true,
    retentionDays: MODERATION_RETENTION_DAYS,
    appliesToReviews: true,
    appliesToHostResponses: true,
    appliesToProperties: true,
  },
  discrimination: {
    code: 'discrimination',
    label: 'Discrimination',
    description: 'Content that discriminates based on protected characteristics.',
    enforcementAction: 'hide_content',
    publicStatusCopy: 'This review was hidden for violating our discrimination policy.',
    severity: 'critical',
    appealable: true,
    retentionDays: MODERATION_RETENTION_DAYS,
    appliesToReviews: true,
    appliesToHostResponses: true,
    appliesToProperties: true,
  },
  fraud: {
    code: 'fraud',
    label: 'Fraud',
    description: 'Scams, payment fraud, or deliberate deception.',
    enforcementAction: 'escalate',
    publicStatusCopy: 'This content is under review for suspected fraud.',
    severity: 'critical',
    appealable: true,
    retentionDays: MODERATION_RETENTION_DAYS,
    appliesToReviews: true,
    appliesToHostResponses: true,
    appliesToProperties: true,
  },
  unsafe_property: {
    code: 'unsafe_property',
    label: 'Unsafe property',
    description: 'Reports of hazardous conditions that put guests at risk.',
    enforcementAction: 'escalate',
    publicStatusCopy: 'This listing is under safety review.',
    severity: 'critical',
    appealable: true,
    retentionDays: MODERATION_RETENTION_DAYS,
    appliesToReviews: false,
    appliesToHostResponses: false,
    appliesToProperties: true,
  },
  privacy_violation: {
    code: 'privacy_violation',
    label: 'Privacy violation',
    description: 'Sharing personal data, contact info, or private details without consent.',
    enforcementAction: 'hide_content',
    publicStatusCopy: 'This review was hidden for a privacy policy violation.',
    severity: 'high',
    appealable: true,
    retentionDays: MODERATION_RETENTION_DAYS,
    appliesToReviews: true,
    appliesToHostResponses: true,
    appliesToProperties: true,
  },
  retaliatory_review: {
    code: 'retaliatory_review',
    label: 'Retaliatory review',
    description: 'Reviews submitted primarily to punish a host after a dispute or unrelated conflict.',
    enforcementAction: 'hide_content',
    publicStatusCopy: 'This review was hidden under our retaliatory review policy.',
    severity: 'medium',
    appealable: true,
    retentionDays: MODERATION_RETENTION_DAYS,
    appliesToReviews: true,
    appliesToHostResponses: false,
    appliesToProperties: false,
  },
  spam: {
    code: 'spam',
    label: 'Spam',
    description: 'Unsolicited commercial content or repetitive low-value posts.',
    enforcementAction: 'reject_content',
    publicStatusCopy: 'This review was removed as spam.',
    severity: 'low',
    appealable: true,
    retentionDays: MODERATION_RETENTION_DAYS,
    appliesToReviews: true,
    appliesToHostResponses: true,
    appliesToProperties: true,
  },
  inappropriate: {
    code: 'inappropriate',
    label: 'Inappropriate content',
    description: 'Sexually explicit, graphic, or otherwise unsuitable content.',
    enforcementAction: 'hide_content',
    publicStatusCopy: 'This review was hidden for inappropriate content.',
    severity: 'high',
    appealable: true,
    retentionDays: MODERATION_RETENTION_DAYS,
    appliesToReviews: true,
    appliesToHostResponses: true,
    appliesToProperties: true,
  },
  misleading: {
    code: 'misleading',
    label: 'Misleading',
    description: 'Materially false statements about a stay, property, or host.',
    enforcementAction: 'flag_for_review',
    publicStatusCopy: 'This review is under review for accuracy.',
    severity: 'medium',
    appealable: true,
    retentionDays: MODERATION_RETENTION_DAYS,
    appliesToReviews: true,
    appliesToHostResponses: true,
    appliesToProperties: true,
  },
  other: {
    code: 'other',
    label: 'Other',
    description: 'Policy concern not covered by a more specific reason code.',
    enforcementAction: 'flag_for_review',
    publicStatusCopy: 'This review is under moderation review.',
    severity: 'medium',
    appealable: true,
    retentionDays: MODERATION_RETENTION_DAYS,
    appliesToReviews: true,
    appliesToHostResponses: true,
    appliesToProperties: true,
  },
};

export interface SafetyPolicySnapshot {
  version: string;
  effectiveDate: string;
  appealWindowDays: number;
  moderationRetentionDays: number;
  hostResponseEditWindowHours: number;
  reasons: SafetyReasonPolicy[];
}

export function getCurrentSafetyPolicySnapshot(): SafetyPolicySnapshot {
  return {
    version: CURRENT_SAFETY_POLICY_VERSION,
    effectiveDate: SAFETY_POLICY_EFFECTIVE_DATE,
    appealWindowDays: APPEAL_WINDOW_DAYS,
    moderationRetentionDays: MODERATION_RETENTION_DAYS,
    hostResponseEditWindowHours: HOST_RESPONSE_EDIT_WINDOW_HOURS,
    reasons: SAFETY_REASON_CODES.map((code) => SAFETY_REASON_POLICIES[code]),
  };
}

export function isValidSafetyReason(code: string): code is SafetyReasonCode {
  return (SAFETY_REASON_CODES as readonly string[]).includes(code);
}

export function getReviewReasonCodes(): SafetyReasonCode[] {
  return SAFETY_REASON_CODES.filter((code) => SAFETY_REASON_POLICIES[code].appliesToReviews);
}

export function getHostResponseReasonCodes(): SafetyReasonCode[] {
  return SAFETY_REASON_CODES.filter((code) => SAFETY_REASON_POLICIES[code].appliesToHostResponses);
}

export function assertReviewReason(code: string): SafetyReasonCode {
  if (!isValidSafetyReason(code) || !SAFETY_REASON_POLICIES[code].appliesToReviews) {
    throw new Error(
      `Unsupported review reason code. Allowed: ${getReviewReasonCodes().join(', ')}`,
    );
  }
  return code;
}

export function publicStatusForReason(code: SafetyReasonCode): string {
  return SAFETY_REASON_POLICIES[code].publicStatusCopy;
}

export function enforcementForReason(code: SafetyReasonCode): EnforcementAction {
  return SAFETY_REASON_POLICIES[code].enforcementAction;
}

/**
 * Map legacy report reasons onto the versioned safety taxonomy so older
 * clients keep working without rewriting historical decisions.
 */
export function mapLegacyReportReason(reason: string): SafetyReasonCode {
  const legacy: Record<string, SafetyReasonCode> = {
    spam: 'spam',
    fraud: 'fraud',
    inappropriate: 'inappropriate',
    misleading: 'misleading',
    harassment: 'harassment',
    other: 'other',
  };
  return legacy[reason] ?? (isValidSafetyReason(reason) ? reason : 'other');
}
