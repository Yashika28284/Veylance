export const FEATURES = ['emergency_admission', 'prior_inpatient_visits', 'length_of_stay', 'medication_count'];
export const RESOURCE = 'federated-model:hospital-readmission';
export const PURPOSE = 'hospital-readmission-research';
export const OPERATIONS = ['train_local', 'submit_update', 'download_model'];
export const REVIEWERS = [
  { role: 'manager', id: 'reviewer-manager', name: 'Elena Walsh', label: 'Manager' },
  { role: 'risk', id: 'reviewer-risk', name: 'Samir Rao', label: 'Risk reviewer' },
  { role: 'owner', id: 'reviewer-owner', name: 'Mara Chen', label: 'Resource owner' }
];
export function effectiveStatus(warrant, now) {
  if (warrant.status === 'revoked' || warrant.status === 'rejected') return warrant.status;
  if (new Date(warrant.expiresAt) <= new Date(now)) return 'expired';
  if (warrant.status === 'approved' && warrant.used >= warrant.quota) return 'exhausted';
  return warrant.status;
}
export function authorize(w, request, now) {
  if (!w) return { allowed: false, code: 'NO_WARRANT', reason: 'No warrant covers this contribution.' };
  const status = effectiveStatus(w, now);
  if (status !== 'approved') return { allowed: false, code: status.toUpperCase(), reason: `Warrant ${w.id} is ${status}.` };
  if (request.resource !== w.resource) return { allowed: false, code: 'RESOURCE_MISMATCH', reason: 'The requested resource is outside the approved scope.' };
  if (request.purpose !== w.purpose) return { allowed: false, code: 'PURPOSE_MISMATCH', reason: 'Purpose does not match hospital-readmission-research.' };
  if (!w.operations.includes(request.operation)) return { allowed: false, code: 'OPERATION_DENIED', reason: 'The operation is outside the approved scope.' };
  const denied = request.features.filter(f => !w.features.includes(f));
  if (denied.length) return { allowed: false, code: 'FEATURE_DENIED', reason: `Restricted or unapproved field: ${denied.join(', ')}. Allowed feature scope is unchanged.` };
  return { allowed: true, code: 'ALLOWED', reason: 'Active warrant; resource, purpose, operation, features and contribution quota match.' };
}
export function validateNarrowing(w, scope) {
  if (!scope.features.length || scope.features.some(f => !w.features.includes(f))) throw new Error('Narrowing must retain a nonempty subset of the requested features.');
  if (!scope.operations.length || scope.operations.some(op => !w.operations.includes(op))) throw new Error('Operations can only be removed.');
  if (!Number.isInteger(scope.quota) || scope.quota < 1 || scope.quota > w.quota) throw new Error('Contribution allowance must be between 1 and the current allowance.');
  if (!Number.isFinite(Date.parse(scope.expiresAt)) || new Date(scope.expiresAt) > new Date(w.expiresAt)) throw new Error('Expiry may only be shortened.');
}
export function demoChecksum(value) {
  let hash = 2166136261;
  for (const char of JSON.stringify(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `demo-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
export function ledgerPayload(entry) { const { hash, ...payload } = entry; return payload; }
