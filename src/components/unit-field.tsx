'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Input, Select } from '@/components/ui/form';
import {
  OTHER_UNIT,
  UNIT_CHOICES,
  unitChoices,
  type BaseUnit,
  type UnitChoice,
} from '@/modules/purchasing/lines';

/**
 * The unit dropdown every quantity uses (bazar, waste, counts, the bazar list): the units that fit the
 * item, then "Other". Choosing Other shows a second box, named `<name>-size`, for how many g / ml /
 * pieces one is; the server reads it with the quantity (toBase). With no `base` (the item is not known
 * yet) every unit is offered.
 */
export function UnitField({
  name,
  base,
  defaultValue,
  ariaLabel,
  className,
  selectClassName,
}: {
  name: string;
  base?: BaseUnit;
  defaultValue: UnitChoice;
  ariaLabel: string;
  /** The wrapper: it is one cell in whatever grid or row the form uses. */
  className?: string;
  selectClassName?: string;
}) {
  const tu = useTranslations('units');
  const [unit, setUnit] = React.useState<string>(defaultValue);
  const choices: readonly UnitChoice[] = base ? unitChoices(base) : UNIT_CHOICES;
  const sizeLabel = tu(
    base === 'g'
      ? 'otherSizeG'
      : base === 'ml'
        ? 'otherSizeMl'
        : base === 'pcs'
          ? 'otherSizePcs'
          : 'otherSizeAny',
  );
  return (
    <div className={className}>
      <Select
        name={name}
        aria-label={ariaLabel}
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        className={selectClassName}
      >
        {choices.map((u) => (
          <option key={u} value={u}>
            {tu(u)}
          </option>
        ))}
      </Select>
      {unit === OTHER_UNIT ? (
        <div className="mt-1 flex items-center gap-1 text-sm text-secondary">
          <span aria-hidden>{'1 ='}</span>
          <Input
            name={`${name}-size`}
            inputMode="decimal"
            maxLength={12}
            required
            aria-label={sizeLabel}
            title={sizeLabel}
            className="min-h-9 w-20 min-w-0 flex-1"
          />
          <span>{tu(base ?? 'otherAny')}</span>
        </div>
      ) : null}
    </div>
  );
}
