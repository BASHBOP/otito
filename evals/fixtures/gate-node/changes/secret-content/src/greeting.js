// Corpus fixture: a credential pasted into ordinary source, which the
// path-only half of the secret gate could never see. The marker below is
// stripped by the gate-effectiveness harness before the gate runs, so the
// committed corpus does not trip otito's own gate while the case still
// exercises real detection.
const AWS_ACCESS_KEY_ID = "AKIA3F7QZL2MXN8RTVWB"; // otito:allow-secret
export const greet = (name) => `hi ${name} ${AWS_ACCESS_KEY_ID}`;
