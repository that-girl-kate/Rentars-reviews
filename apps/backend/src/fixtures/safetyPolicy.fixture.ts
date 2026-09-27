/**
 * Fixture export of the versioned safety taxonomy for tests, seeds, and
 * moderator tooling. Importing this never mutates historical decisions.
 */

import {
  CURRENT_SAFETY_POLICY_VERSION,
  SAFETY_POLICY_EFFECTIVE_DATE,
  SAFETY_REASON_CODES,
  SAFETY_REASON_POLICIES,
  getCurrentSafetyPolicySnapshot,
  type SafetyReasonCode,
} from '../services/contentSafetyPolicy.service.js';

export const safetyPolicyFixture = {
  version: CURRENT_SAFETY_POLICY_VERSION,
  effectiveDate: SAFETY_POLICY_EFFECTIVE_DATE,
  reasonCodes: [...SAFETY_REASON_CODES],
  policies: SAFETY_REASON_POLICIES,
  snapshot: getCurrentSafetyPolicySnapshot(),
};

/** Every review-applicable reason must have a documented enforcement action. */
export function assertCompleteReviewTaxonomy(): void {
  const reviewCodes = SAFETY_REASON_CODES.filter(
    (code) => SAFETY_REASON_POLICIES[code].appliesToReviews,
  );
  for (const code of reviewCodes) {
    const policy = SAFETY_REASON_POLICIES[code as SafetyReasonCode];
    if (!policy.enforcementAction) {
      throw new Error(`Missing enforcement action for ${code}`);
    }
    if (!policy.publicStatusCopy) {
      throw new Error(`Missing public status copy for ${code}`);
    }
  }
}
