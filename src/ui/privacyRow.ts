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

/** Styling of the row, independent of whether it should be shown. Exported so
 *  callers can build the object once and drive visibility separately, rather
 *  than asserting non-null on privacyRow(true). */
export const PRIVACY_ROW_STYLE: PrivacyRow = { label: 'Privacy options', color: '#aaccff' };

export function privacyRow(required: boolean): PrivacyRow | null {
  return required ? PRIVACY_ROW_STYLE : null;
}
