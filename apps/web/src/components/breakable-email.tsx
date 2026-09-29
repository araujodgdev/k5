import { Fragment } from 'react';

/**
 * An e-mail address that may wrap after the "@" or before a dot, the way addresses are broken in
 * print, instead of in the middle of a word. A single part longer than the line still breaks, and
 * (overflow-wrap: anywhere) never widens the column that holds it.
 */
export function BreakableEmail({ email }: { email: string }) {
  const parts = email.split(/(?<=@)|(?=\.)/);
  return <span className="[overflow-wrap:anywhere]">{parts.map((part, index) => <Fragment key={index}>{index > 0 && <wbr />}{part}</Fragment>)}</span>;
}
