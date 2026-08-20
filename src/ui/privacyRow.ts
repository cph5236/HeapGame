/** Presentation of the Settings -> Privacy options row.
 *
 *  Google only has a privacy options form to open where consent was gathered
 *  (EEA/UK/Switzerland). Everywhere else the row is omitted rather than shown
 *  disabled: a permanently greyed control reads as broken, not as inapplicable.
 *  PRIVACY_POLICY.md scopes its revocation wording to match. */
export interface PrivacyRow {
  label: string;
  color: string;
}

export function privacyRow(required: boolean): PrivacyRow | null {
  return required ? { label: 'Privacy options', color: '#aaccff' } : null;
}
