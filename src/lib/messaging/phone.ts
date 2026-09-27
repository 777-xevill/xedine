/** +880 1XXXXXXXXX, from anything a person might type (spaces, dashes, 01…, 8801…). */
export function normalizeBdPhone(input: string): string | null {
  const digits = input.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/\D/g, '');
  const local = digits.startsWith('880')
    ? digits.slice(3)
    : digits.startsWith('0')
      ? digits.slice(1)
      : digits;
  return /^1[3-9]\d{8}$/.test(local) ? `+880${local}` : null;
}
